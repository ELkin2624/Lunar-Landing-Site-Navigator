"""Compare complete sampled visibility windows with an independent orbit.

Uses INPOP19a for Sun/Earth orbits and the shared DE440 lunar orientation.
The same LOLA skyline is applied to both calculations, so this validates the
orbital contribution to windows, not an independent terrain solution.
"""

import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx
import spiceypy as spice

from app.analysis import horizon_at
from app.horizons import HorizonsClient
from app.models import Site
from app.terrain import LolaDem, horizon_profile
from validate_spice import spice_angles, sha256

ROOT = Path(__file__).resolve().parents[2]
KERNEL_DIR = ROOT / "backend" / "data" / "kernels"
KERNELS = ("naif0012.tls", "inpop19a_19900101_20500101.bsp",
           "moon_pa_de440_200625.bpc", "moon_de440_250416.tf")


def windows(rows, start, end):
    result = []
    opened = start if rows[0][1] else None
    for (instant, visible), (next_instant, next_visible) in zip(rows, rows[1:]):
        if visible and not next_visible:
            result.append([opened.isoformat(), next_instant.isoformat()])
            opened = None
        elif not visible and next_visible:
            opened = next_instant
    if rows[-1][1]:
        result.append([opened.isoformat(), end.isoformat()])
    return result


async def main():
    for name in KERNELS:
        path = KERNEL_DIR / name
        if not path.exists():
            raise SystemExit(f"Missing kernel: {path}")
        spice.furnsh(str(path))
    cases = [
        ("Mons Mouton", -84.6, 31, datetime(2026, 11, 15, tzinfo=timezone.utc)),
        ("de Gerlache sample", -88.3, -59.5, datetime(2027, 2, 15, tzinfo=timezone.utc)),
    ]
    output = []
    try:
        with LolaDem(ROOT / "backend/data/ldem_75s_240m.img") as broad, LolaDem(ROOT / "backend/data/ldem_875s_20m.img") as fine:
            async with httpx.AsyncClient(timeout=60) as client:
                horizons = HorizonsClient(client)
                for label, latitude, longitude, start in cases:
                    site = Site(latitude_deg=latitude, longitude_deg=longitude, label=label)
                    profile, height_km = horizon_profile(broad, site, fine_dem=fine)
                    coarse_profile, _ = horizon_profile(broad, site)
                    site = site.model_copy(update={"height_km": height_km})
                    end = start + timedelta(days=7)
                    bodies = []
                    for name, number in (("SUN", 10), ("EARTH", 399)):
                        observed = await horizons.positions(number, site, start, end, 30)
                        observed = [row for row in observed if row[0] < end]
                        hz_rows = [(instant, elevation > horizon_at(profile, azimuth))
                                   for instant, azimuth, elevation in observed]
                        coarse_rows = [(instant, elevation > horizon_at(coarse_profile, azimuth))
                                       for instant, azimuth, elevation in observed]
                        sp_rows = []
                        for instant, _, _ in observed:
                            azimuth, elevation = spice_angles(name, site, instant)
                            sp_rows.append((instant, elevation > horizon_at(profile, azimuth)))
                        hz_windows = windows(hz_rows, start, end)
                        sp_windows = windows(sp_rows, start, end)
                        bodies.append({
                            "body": name, "samples": len(hz_rows),
                            "classification_disagreements": sum(a[1] != b[1] for a, b in zip(hz_rows, sp_rows)),
                            "horizons_visible_fraction": sum(row[1] for row in hz_rows) / len(hz_rows),
                            "inpop_visible_fraction": sum(row[1] for row in sp_rows) / len(sp_rows),
                            "horizons_windows": hz_windows, "inpop_windows": sp_windows,
                            "coarse_240m_windows": windows(coarse_rows, start, end),
                            "mixed_vs_coarse_disagreements": sum(a[1] != b[1] for a, b in zip(hz_rows, coarse_rows)),
                            "coarse_240m_visible_fraction": sum(row[1] for row in coarse_rows) / len(coarse_rows),
                            "windows_equal_on_30_minute_grid": hz_windows == sp_windows,
                        })
                    output.append({"site": label, "latitude_deg": latitude,
                                   "longitude_deg": longitude, "start_utc": start.isoformat(),
                                   "end_utc": end.isoformat(), "bodies": bodies,
                                   "horizon_sources": sorted({p.obstacle_source for p in profile if p.obstacle_source})})
    finally:
        spice.kclear()
    report = {"method": "Horizons versus INPOP19a at 30-minute grid using the same mixed LOLA skyline",
              "shared_lunar_orientation": "moon_pa_de440_200625.bpc",
              "kernel_sha256": {name: sha256(KERNEL_DIR / name) for name in KERNELS},
              "cases": output,
              "limit": "Tests complete sampled windows at 30-minute resolution; cannot detect events wholly between samples. Orbital solution is independent; lunar orientation and LOLA terrain are shared."}
    target = ROOT / "docs/VALIDACION_VENTANAS_SPICE.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(target)
    for case in output:
        print(case["site"], [(body["body"], body["classification_disagreements"], body["windows_equal_on_30_minute_grid"]) for body in case["bodies"]])


if __name__ == "__main__":
    asyncio.run(main())
