"""Offline seasonal sensitivity audit using installed SPICE kernels and LOLA DEMs.

This expands site/date/coverage checks. It does not replace a comparison with
independent ground truth or certify the DEM uncertainty band.
"""

from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path

import spiceypy as spice

from app.analysis import horizon_at
from app.models import Site
from app.terrain import LolaDem, TerrainError, dem_error_envelopes, horizon_profile
from validate_independent import spice_angles_frame

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend" / "data"
KERNELS = DATA / "kernels"
SITES = [
    ("Mons Mouton", -84.6, 31.0),
    ("Mons Malapert", -85.98, -1.67),
    ("de Gerlache Rim 2", -88.3, -59.5),
    ("Connecting Ridge", -89.4, -137.5),
    ("LOLA fine boundary south", -87.51, 0.0),
]
SEASONS = ["2027-03-20", "2027-06-21", "2027-09-23", "2027-12-22"]
KERNEL_FILES = ["naif0012.tls", "inpop19a_19900101_20500101.bsp", "moon_pa_de440_200625.bpc",
                "moon_de440_250416.tf", "pck00011.tpc"]


def main() -> None:
    for name in KERNEL_FILES:
        if not (KERNELS / name).is_file():
            raise SystemExit(f"Missing kernel: {name}")
    spice.kclear()
    for name in KERNEL_FILES:
        spice.furnsh(str(KERNELS / name))
    cases = []
    coverage = []
    try:
        with LolaDem(DATA / "ldem_75s_240m.img") as broad, LolaDem(DATA / "ldem_875s_20m.img") as fine:
            for lat in (-90.0, -87.51, -87.49, -75.01, -74.99):
                coverage.append({"latitude_deg": lat, "broad": _covered(broad, lat), "fine": _covered(fine, lat)})
            for label, lat, lon in SITES:
                raw_site = Site(latitude_deg=lat, longitude_deg=lon, label=label)
                mixed, height = horizon_profile(broad, raw_site, fine_dem=fine, azimuth_step_deg=10)
                coarse, _ = horizon_profile(broad, raw_site, azimuth_step_deg=10)
                uses_fine = _covered(fine, lat)
                upper, lower, _ = dem_error_envelopes(mixed, uses_fine_site=uses_fine)
                site = raw_site.model_copy(update={"height_km": height})
                for start_day in SEASONS:
                    start = datetime.fromisoformat(start_day).replace(tzinfo=timezone.utc)
                    for body in ("SUN", "EARTH"):
                        counts = {"mixed_visible": 0, "coarse_visible": 0, "dem_classification_changes": 0,
                                  "orientation_classification_changes": 0, "vertical_band_ambiguous": 0,
                                  "mixed_transitions": 0}
                        previous = None
                        for hour in range(7 * 24):
                            instant = start + timedelta(hours=hour)
                            az, el = spice_angles_frame(body, site, instant, "MOON_ME")
                            iau_az, iau_el = spice_angles_frame(body, site, instant, "IAU_MOON")
                            visible = el > horizon_at(mixed, az)
                            coarse_visible = el > horizon_at(coarse, az)
                            iau_visible = iau_el > horizon_at(mixed, iau_az)
                            counts["mixed_visible"] += int(visible)
                            counts["coarse_visible"] += int(coarse_visible)
                            counts["dem_classification_changes"] += int(visible != coarse_visible)
                            counts["orientation_classification_changes"] += int(visible != iau_visible)
                            counts["vertical_band_ambiguous"] += int(horizon_at(lower, az) <= el <= horizon_at(upper, az))
                            if previous is not None and visible != previous:
                                counts["mixed_transitions"] += 1
                            previous = visible
                        cases.append({"site": label, "latitude_deg": lat, "longitude_deg": lon,
                                      "start_utc": start.isoformat(), "body": body, "samples": 168,
                                      "fine_dem_used": uses_fine, **counts})
    finally:
        spice.kclear()
    report = {
        "method": "INPOP19a orbit, MOON_ME vs analytic IAU_MOON, 7 days at 60 min, 10 degree horizon grid, LOLA mixed vs 240m",
        "limitations": "Model sensitivity, not accuracy against independent terrain at all sites. Hourly events shorter than one hour can be missed. 10 degree horizon interpolation is coarser than operational 1 degree.",
        "kernel_sha256": {name: hashlib.sha256((KERNELS / name).read_bytes()).hexdigest() for name in KERNEL_FILES},
        "coverage_probes": coverage,
        "cases": cases,
    }
    target = ROOT / "docs" / "VALIDACION_ESTACIONAL.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Wrote {target}: {len(cases)} body/site/season cases")


def _covered(dem: LolaDem, lat: float) -> bool:
    try:
        dem.pixel_index(lat, 0)
        return True
    except TerrainError:
        return False


if __name__ == "__main__":
    main()
