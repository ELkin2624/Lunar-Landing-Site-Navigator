"""Minute-scale transition validation with independent lunar orientation and orbit models.

Downloads NAIF generic pck00011.tpc (analytic IAU_MOON rotation) if missing,
then compares Horizons (DE440/DE441) against:
  1) IMCCE INPOP19a orbit + DE440 MOON_ME lunar libration kernel
  2) IMCCE INPOP19a orbit + IAU_MOON analytic orientation (pck00011.tpc)
on a 5-minute grid using the mixed LOLA (20 m near + 240 m far) skyline.

Also probes NASA Moon Trek catalog metadata to report transparently whether
non-LOLA LROC NAC stereo DEM products are accessible without bulk archives.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path

import httpx
import spiceypy as spice

from app.analysis import horizon_at
from app.horizons import HorizonsClient
from app.models import Site
from app.terrain import LolaDem, horizon_profile
from validate_nac_stereo import run_nac_validation

ROOT = Path(__file__).resolve().parents[2]
KERNEL_DIR = ROOT / "backend" / "data" / "kernels"
PCK00011_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc"
RADIUS_KM = 1737.4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def circular_diff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def spice_angles_frame(body: str, site: Site, instant: datetime, frame: str) -> tuple[float, float]:
    et = spice.str2et(instant.strftime("%Y-%m-%d %H:%M:%S UTC"))
    apparent, _ = spice.spkpos(body, et, frame, "LT+S", "MOON")
    lat, lon = math.radians(site.latitude_deg), math.radians(site.longitude_deg)
    radius = RADIUS_KM + site.height_km
    up = (math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))
    east = (-math.sin(lon), math.cos(lon), 0.0)
    north = (-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat))
    target = [apparent[i] - radius * up[i] for i in range(3)]
    dot = lambda axis: sum(target[i] * axis[i] for i in range(3))
    azimuth = math.degrees(math.atan2(dot(east), dot(north))) % 360.0
    elevation = math.degrees(math.asin(dot(up) / math.sqrt(sum(v * v for v in target))))
    return azimuth, elevation


def extract_transitions(rows: list[tuple[datetime, bool]]) -> list[tuple[str, datetime]]:
    events: list[tuple[str, datetime]] = []
    for (t0, v0), (t1, v1) in zip(rows, rows[1:]):
        if v0 != v1:
            midpoint = t0 + (t1 - t0) / 2
            events.append(("rise" if v1 else "set", midpoint))
    return events


async def ensure_pck00011(client: httpx.AsyncClient) -> Path:
    target = KERNEL_DIR / "pck00011.tpc"
    if target.exists() and target.stat().st_size > 10000:
        return target
    KERNEL_DIR.mkdir(parents=True, exist_ok=True)
    resp = await client.get(PCK00011_URL, follow_redirects=True)
    resp.raise_for_status()
    target.write_bytes(resp.content)
    return target


async def check_external_stereo_catalog(client: httpx.AsyncClient) -> dict:
    """Query NASA Moon Trek search catalog for non-LOLA South Pole LROC NAC DTMs."""
    url = "https://trek.nasa.gov/moon/TrekWS/rest/cat/items/search"
    params = {"q": "NAC DTM South Pole", "start": 0, "rows": 5}
    try:
        resp = await client.get(url, params=params, timeout=15)
        if resp.status_code != 200:
            return {
                "status": "not_evaluated_endpoint_unavailable",
                "http_status": resp.status_code,
                "url": str(resp.url),
                "note": "No se pudo consultar el catálogo Moon Trek para DTMs estéreo LROC NAC.",
            }
        data = resp.json()
        docs = data.get("response", {}).get("docs", []) if isinstance(data, dict) else []
        titles = [str(d.get("title", d.get("productLabel", ""))) for d in docs[:5]]
        return {
            "status": "catalog_checked_bulk_raster_required",
            "url": str(resp.url),
            "sample_catalog_items": titles,
            "note": (
                "La comparación punto a punto entre LOLA y pares estéreo LROC NAC (GeoTIFF/PDS IMG externos) "
                "requiere descargar archivos raster externos de gran tamaño; sigue pendiente de ejecución en este entorno."
            ),
        }
    except Exception as exc:
        return {
            "status": "not_evaluated_network_or_catalog_error",
            "error": str(exc),
            "note": "No se completó la consulta externa de DTMs estéreo LROC NAC; sigue pendiente.",
        }


async def main() -> None:
    req_kernels = [
        "naif0012.tls",
        "inpop19a_19900101_20500101.bsp",
        "moon_pa_de440_200625.bpc",
        "moon_de440_250416.tf",
    ]
    for name in req_kernels:
        if not (KERNEL_DIR / name).exists():
            raise SystemExit(f"Missing required kernel: {KERNEL_DIR / name}")

    start = datetime(2027, 2, 15, 0, 0, tzinfo=timezone.utc)
    end = start + timedelta(days=7)
    step_min = 5

    cases = [
        ("de Gerlache Rim 2", -88.3, -59.5),
        ("Mons Mouton", -84.6, 31.0),
    ]

    async with httpx.AsyncClient(timeout=60) as client:
        pck_path = await ensure_pck00011(client)
        stereo_status = run_nac_validation()
        horizons = HorizonsClient(client)

        spice.kclear()
        for name in req_kernels:
            spice.furnsh(str(KERNEL_DIR / name))
        spice.furnsh(str(pck_path))

        case_reports = []
        try:
            with (
                LolaDem(ROOT / "backend" / "data" / "ldem_75s_240m.img") as broad,
                LolaDem(ROOT / "backend" / "data" / "ldem_875s_20m.img") as fine,
            ):
                for label, lat, lon in cases:
                    raw_site = Site(latitude_deg=lat, longitude_deg=lon, label=label)
                    profile, height_km = horizon_profile(broad, raw_site, fine_dem=fine)
                    site = raw_site.model_copy(update={"height_km": height_km})

                    body_reports = []
                    for body_name, horizons_id in (("SUN", 10), ("EARTH", 399)):
                        # Horizons returns up to ~10k lines; 7 days at 5 min = 2017 samples (single call)
                        observed = await horizons.positions(horizons_id, site, start, end, step_min)
                        observed = [row for row in observed if row[0] < end]

                        hz_vis: list[tuple[datetime, bool]] = []
                        de440_vis: list[tuple[datetime, bool]] = []
                        iau_vis: list[tuple[datetime, bool]] = []
                        max_az_diff_iau = 0.0
                        max_el_diff_iau = 0.0
                        max_az_diff_de440 = 0.0
                        max_el_diff_de440 = 0.0

                        for instant, hz_az, hz_el in observed:
                            hz_vis.append((instant, hz_el > horizon_at(profile, hz_az)))

                            d_az, d_el = spice_angles_frame(body_name, site, instant, "MOON_ME")
                            de440_vis.append((instant, d_el > horizon_at(profile, d_az)))
                            max_az_diff_de440 = max(max_az_diff_de440, circular_diff(hz_az, d_az))
                            max_el_diff_de440 = max(max_el_diff_de440, abs(hz_el - d_el))

                            i_az, i_el = spice_angles_frame(body_name, site, instant, "IAU_MOON")
                            iau_vis.append((instant, i_el > horizon_at(profile, i_az)))
                            max_az_diff_iau = max(max_az_diff_iau, circular_diff(hz_az, i_az))
                            max_el_diff_iau = max(max_el_diff_iau, abs(hz_el - i_el))

                        hz_events = extract_transitions(hz_vis)
                        de440_events = extract_transitions(de440_vis)
                        iau_events = extract_transitions(iau_vis)

                        max_transition_shift_min = None
                        if len(hz_events) == len(iau_events) and len(hz_events) > 0:
                            max_transition_shift_min = round(
                                max(abs((a[1] - b[1]).total_seconds()) / 60.0 for a, b in zip(hz_events, iau_events)),
                                2,
                            )

                        disagreements_de440 = sum(a[1] != b[1] for a, b in zip(hz_vis, de440_vis))
                        disagreements_iau = sum(a[1] != b[1] for a, b in zip(hz_vis, iau_vis))

                        body_reports.append(
                            {
                                "body": body_name,
                                "samples_5min": len(observed),
                                "horizons_vs_inpop_moon_me": {
                                    "max_azimuth_diff_deg": round(max_az_diff_de440, 6),
                                    "max_elevation_diff_deg": round(max_el_diff_de440, 6),
                                    "classification_disagreements": disagreements_de440,
                                },
                                "horizons_vs_inpop_iau_moon": {
                                    "max_azimuth_diff_deg": round(max_az_diff_iau, 4),
                                    "max_elevation_diff_deg": round(max_el_diff_iau, 4),
                                    "classification_disagreements": disagreements_iau,
                                    "horizons_transition_count": len(hz_events),
                                    "iau_moon_transition_count": len(iau_events),
                                    "max_transition_time_shift_minutes": max_transition_shift_min,
                                },
                            }
                        )

                    case_reports.append(
                        {
                            "site": label,
                            "latitude_deg": lat,
                            "longitude_deg": lon,
                            "height_km_used": round(height_km, 4),
                            "start_utc": start.isoformat(),
                            "end_utc": end.isoformat(),
                            "step_minutes": step_min,
                            "bodies": body_reports,
                        }
                    )
        finally:
            spice.kclear()

    report = {
        "method": (
            "Minute-scale (5 min) comparison between JPL Horizons (DE440/441), "
            "IMCCE INPOP19a + MOON_ME (DE440 libration PCK), and "
            "IMCCE INPOP19a + IAU_MOON (NAIF pck00011.tpc analytic orientation)"
        ),
        "pck00011_url": PCK00011_URL,
        "pck00011_sha256": sha256(pck_path),
        "cases": case_reports,
        "external_stereo_dem_validation": stereo_status,
        "scientific_interpretation": (
            "IAU_MOON is an analytic uniform-rotation frame omitting physical librations and the "
            "principal-axis to Mean-Earth offset (~0.02 deg), so small angular and single-step transition "
            "differences versus DE440 MOON_ME measure sensitivity to the lunar orientation model."
        ),
    }

    target = ROOT / "docs" / "VALIDACION_INDEPENDIENTE.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {target}")
    for c in case_reports:
        print(c["site"])
        for b in c["bodies"]:
            print(" ", b["body"], b["horizons_vs_inpop_iau_moon"])
    print("Stereo DEM:", stereo_status["status"])


if __name__ == "__main__":
    asyncio.run(main())
