"""Validate local LOLA 20 m and 240 m DEMs against independent LROC NAC stereo DTMs.

Downloads/reads official PDS4 LROC NAC Digital Terrain Models (GeoTIFF, 2 m/px):
  - NAC_DTM_ESALL_CR1.TIF (Connecting Ridge: overlaps both LOLA 20 m and 240 m)
  - NAC_DTM_ESALL_MP1.TIF (Mons Malapert: overlaps LOLA 240 m)

Computes:
  1. Elevation bias, MAE, RMSE, P95, and max absolute difference (NAC vs LOLA 20 m & 240 m).
  2. Empirical 2D cross-correlation / RMSE minimization to estimate horizontal
     co-registration offset (dx_m, dy_m) between LOLA and LROC NAC stereo frames.
  3. 20 m vs 240 m LOLA boundary discontinuity along latitude -87.5 deg (fine grid edge).
  4. Ray-traced local obstacle skyline comparison over the NAC DTM extent vs LOLA 20 m / 240 m.

Saves docs/VALIDACION_STEREO_NAC.json.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from app.models import HorizonPoint
from app.terrain import LolaDem, REFERENCE_RADIUS_M, TerrainError, dem_error_envelopes

ROOT = Path(__file__).resolve().parents[2]
NAC_DIR = ROOT / "backend" / "data" / "nac_dtm"

NAC_PRODUCTS = [
    {
        "product_id": "NAC_DTM_ESALL_CR1",
        "region": "Connecting Ridge (Shackleton-de Gerlache)",
        "url": "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/ESALL_CR1/NAC_DTM_ESALL_CR1.TIF",
    },
    {
        "product_id": "NAC_DTM_ESALL_MP1",
        "region": "Mons Malapert",
        "url": "https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/ESALL_MP1/NAC_DTM_ESALL_MP1.TIF",
    },
]


def _xy_to_latlon(x_m: float, y_m: float) -> tuple[float, float]:
    rho = math.hypot(x_m, y_m)
    lat = math.degrees(2.0 * math.atan(rho / (2.0 * REFERENCE_RADIUS_M))) - 90.0
    lon = math.degrees(math.atan2(x_m, y_m))
    return lat, lon


def _ensure_nac_tif(product_id: str, url: str) -> Path:
    NAC_DIR.mkdir(parents=True, exist_ok=True)
    path = NAC_DIR / f"{product_id}.TIF"
    if path.exists() and path.stat().st_size > 1_000_000:
        return path
    with httpx.stream("GET", url, follow_redirects=True, timeout=90) as resp:
        resp.raise_for_status()
        path.write_bytes(resp.read())
    return path


def _load_nac(path: Path) -> tuple[np.ndarray, float, float, float, float]:
    with Image.open(path) as im:
        arr = np.asarray(im, dtype=np.float64)
        sx, sy, _ = im.tag_v2[33550]
        _, _, _, x0, y0, _ = im.tag_v2[33922]
    return arr, float(sx), float(sy), float(x0), float(y0)


def _error_stats(diffs: np.ndarray) -> dict:
    abs_d = np.abs(diffs)
    return {
        "samples": int(len(diffs)),
        "mean_bias_m_nac_minus_lola": round(float(np.mean(diffs)), 3),
        "std_m": round(float(np.std(diffs)), 3),
        "mae_m": round(float(np.mean(abs_d)), 3),
        "rmse_m": round(float(np.sqrt(np.mean(diffs ** 2))), 3),
        "p95_abs_m": round(float(np.percentile(abs_d, 95)), 3),
        "max_abs_m": round(float(np.max(abs_d)), 3),
    }


def _estimate_horizontal_shift(
    arr: np.ndarray,
    sx: float,
    sy: float,
    x0: float,
    y0: float,
    dem: LolaDem,
    sample_rc: list[tuple[int, int]],
    offsets_m: list[int],
) -> dict:
    best = {"dx_m": 0, "dy_m": 0, "rmse_m": float("inf"), "bias_corrected_std_m": float("inf")}
    zero_std = None
    nac_vals = np.array([arr[r, c] for r, c in sample_rc], dtype=np.float64)
    base_xs = np.array([x0 + (c + 0.5) * sx for _, c in sample_rc], dtype=np.float64)
    base_ys = np.array([y0 - (r + 0.5) * sy for r, _ in sample_rc], dtype=np.float64)

    for dx in offsets_m:
        for dy in offsets_m:
            lola_vals = []
            ok = True
            for bx, by in zip(base_xs, base_ys):
                lat, lon = _xy_to_latlon(float(bx + dx), float(by + dy))
                try:
                    lola_vals.append(dem.height_m(lat, lon))
                except TerrainError:
                    ok = False
                    break
            if not ok:
                continue
            diff = nac_vals - np.array(lola_vals, dtype=np.float64)
            std = float(np.std(diff))
            rmse = float(np.sqrt(np.mean(diff ** 2)))
            if dx == 0 and dy == 0:
                zero_std = std
            if std < best["bias_corrected_std_m"]:
                best = {
                    "dx_m": dx,
                    "dy_m": dy,
                    "rmse_m": round(rmse, 3),
                    "bias_corrected_std_m": round(std, 3),
                }
    best["zero_shift_std_m"] = round(zero_std, 3) if zero_std is not None else None
    return best


def _local_horizon_comparison(
    arr: np.ndarray,
    sx: float,
    sy: float,
    x0: float,
    y0: float,
    broad: LolaDem,
    fine: LolaDem | None,
) -> dict:
    """Compare local horizon angles within +/-2 km center box of NAC vs LOLA."""
    h, w = arr.shape
    cr, cc = h // 2, w // 2
    # Move outward slightly until we hit a valid pixel near center
    for dr in range(0, 50, 2):
        val = arr[cr + dr, cc + dr]
        if np.isfinite(val) and -1e5 < val < 1e5:
            cr, cc = cr + dr, cc + dr
            break
    cx = x0 + (cc + 0.5) * sx
    cy = y0 - (cr + 0.5) * sy
    c_nac_h = float(arr[cr, cc])
    c_lat, c_lon = _xy_to_latlon(cx, cy)
    c_lola_h = fine.height_m(c_lat, c_lon) if fine is not None else broad.height_m(c_lat, c_lon)

    diffs_deg = []
    diffs_240_deg = []
    contained_fine = []
    contained_broad = []
    envelope_fine = []
    envelope_broad = []
    # Trace rays every 10 deg out to max distance staying strictly inside NAC tile
    for az in range(0, 360, 10):
        az_rad = math.radians(az)
        sky_nac = -90.0
        sky_fine = -90.0
        sky_broad = -90.0
        distance_fine = 20
        distance_broad = 20
        for dist_m in range(20, 2001, 20):
            px = cx + dist_m * math.sin(az_rad)
            py = cy + dist_m * math.cos(az_rad)
            col = int(math.floor((px - x0) / sx))
            row = int(math.floor((y0 - py) / sy))
            if not (0 <= row < h and 0 <= col < w):
                break
            z_nac = arr[row, col]
            if not (np.isfinite(z_nac) and -1e5 < z_nac < 1e5):
                continue
            lat, lon = _xy_to_latlon(px, py)
            sky_nac = max(sky_nac, math.degrees(math.atan2(float(z_nac) - (c_nac_h + 2.0), dist_m)))
            angle_broad = math.degrees(math.atan2(broad.height_m(lat, lon) - (broad.height_m(c_lat, c_lon) + 2.0), dist_m))
            if angle_broad > sky_broad:
                sky_broad, distance_broad = angle_broad, dist_m
            if fine is not None:
                angle_fine = math.degrees(math.atan2(fine.height_m(lat, lon) - (c_lola_h + 2.0), dist_m))
                if angle_fine > sky_fine:
                    sky_fine, distance_fine = angle_fine, dist_m
        if sky_nac > -89.0:
            diffs_240_deg.append(abs(sky_nac - sky_broad))
            point = HorizonPoint(azimuth_deg=az, elevation_deg=sky_broad,
                                 obstacle_distance_km=distance_broad / 1000, obstacle_pixel_scale_m=240)
            upper, lower, _ = dem_error_envelopes([point], uses_fine_site=False)
            envelope_broad.append(upper[0].elevation_deg - sky_broad)
            contained_broad.append(lower[0].elevation_deg <= sky_nac <= upper[0].elevation_deg)
            if fine is not None:
                diffs_deg.append(abs(sky_nac - sky_fine))
                point = HorizonPoint(azimuth_deg=az, elevation_deg=sky_fine,
                                     obstacle_distance_km=distance_fine / 1000, obstacle_pixel_scale_m=20)
                upper, lower, _ = dem_error_envelopes([point], uses_fine_site=True)
                envelope_fine.append(upper[0].elevation_deg - sky_fine)
                contained_fine.append(lower[0].elevation_deg <= sky_nac <= upper[0].elevation_deg)

    return {
        "center_lat_deg": round(c_lat, 5),
        "center_lon_deg": round(c_lon, 5),
        "max_distance_m": 2000,
        "azimuths_evaluated": len(diffs_240_deg),
        "mean_horizon_abs_diff_vs_lola_240m_deg": round(float(np.mean(diffs_240_deg)), 3) if diffs_240_deg else None,
        "mean_horizon_abs_diff_vs_lola_20m_deg": round(float(np.mean(diffs_deg)), 3) if diffs_deg else None,
        "p95_horizon_abs_diff_vs_lola_20m_deg": round(float(np.percentile(diffs_deg, 95)), 3) if diffs_deg else None,
        "fraction_nac_horizon_within_3sigma_20m": round(float(np.mean(contained_fine)), 3) if contained_fine else None,
        "fraction_nac_horizon_within_3sigma_240m": round(float(np.mean(contained_broad)), 3) if contained_broad else None,
        "median_3sigma_envelope_20m_deg": round(float(np.median(envelope_fine)), 3) if envelope_fine else None,
        "median_3sigma_envelope_240m_deg": round(float(np.median(envelope_broad)), 3) if envelope_broad else None,
    }


def _fine_broad_boundary_check(broad: LolaDem, fine: LolaDem) -> dict:
    """Measure elevation difference across the -87.5 deg boundary between LOLA 20 m and 240 m."""
    diffs = []
    for lon in range(-180, 180, 5):
        for lat in (-87.52, -87.6, -88.0):
            try:
                h_fine = fine.height_m(lat, lon)
                h_broad = broad.height_m(lat, lon)
                diffs.append(h_fine - h_broad)
            except TerrainError:
                pass
    arr = np.array(diffs, dtype=np.float64)
    abs_arr = np.abs(arr)
    return {
        "samples": int(len(arr)),
        "latitudes_tested_deg": [-87.52, -87.6, -88.0],
        "mean_bias_m_20m_minus_240m": round(float(np.mean(arr)), 3),
        "rmse_m": round(float(np.sqrt(np.mean(arr ** 2))), 3),
        "p95_abs_m": round(float(np.percentile(abs_arr, 95)), 3),
        "max_abs_m": round(float(np.max(abs_arr)), 3),
    }


def run_nac_validation() -> dict:
    results = []
    with (
        LolaDem(ROOT / "backend" / "data" / "ldem_75s_240m.img") as broad,
        LolaDem(ROOT / "backend" / "data" / "ldem_875s_20m.img") as fine,
    ):
        for prod in NAC_PRODUCTS:
            tif_path = _ensure_nac_tif(prod["product_id"], prod["url"])
            arr, sx, sy, x0, y0 = _load_nac(tif_path)
            valid = np.isfinite(arr) & (arr > -1e5) & (arr < 1e5)
            rows, cols = np.where(valid)
            step = max(1, len(rows) // 4000)
            sample_rc = [(int(r), int(c)) for r, c in zip(rows[::step], cols[::step])]

            diffs_240 = []
            diffs_20 = []
            for r, c in sample_rc:
                x = x0 + (c + 0.5) * sx
                y = y0 - (r + 0.5) * sy
                lat, lon = _xy_to_latlon(x, y)
                h_nac = float(arr[r, c])
                diffs_240.append(h_nac - broad.height_m(lat, lon))
                try:
                    diffs_20.append(h_nac - fine.height_m(lat, lon))
                except TerrainError:
                    pass

            reg_rc = sample_rc[:: max(1, len(sample_rc) // 500)]
            reg_20 = (
                _estimate_horizontal_shift(arr, sx, sy, x0, y0, fine, reg_rc, [-40, -20, -10, 0, 10, 20, 40])
                if diffs_20
                else None
            )
            reg_240 = _estimate_horizontal_shift(arr, sx, sy, x0, y0, broad, reg_rc, [-240, -120, -60, 0, 60, 120, 240])
            horizon_comp = _local_horizon_comparison(arr, sx, sy, x0, y0, broad, fine if diffs_20 else None)

            results.append(
                {
                    "product_id": prod["product_id"],
                    "region": prod["region"],
                    "url": prod["url"],
                    "nac_pixel_scale_m": sx,
                    "valid_fraction": round(float(np.mean(valid)), 4),
                    "vs_lola_240m": _error_stats(np.array(diffs_240, dtype=np.float64)),
                    "vs_lola_20m": _error_stats(np.array(diffs_20, dtype=np.float64)) if diffs_20 else None,
                    "horizontal_registration_vs_20m": reg_20,
                    "horizontal_registration_vs_240m": reg_240,
                    "local_2km_horizon_comparison": horizon_comp,
                }
            )

        boundary = _fine_broad_boundary_check(broad, fine)

    report = {
        "status": "validated",
        "method": "Direct point-by-point & 2 km horizon comparison of LOLA LDEM_875S_20M and LDEM_75S_240M against independent PDS4 LROC NAC stereo DTMs (2.0 m/px)",
        "products": results,
        "lola_20m_vs_240m_boundary": boundary,
    }
    target = ROOT / "docs" / "VALIDACION_STEREO_NAC.json"
    target.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


if __name__ == "__main__":
    rep = run_nac_validation()
    print("Wrote docs/VALIDACION_STEREO_NAC.json")
    for p in rep["products"]:
        print(p["product_id"], "vs 240m:", p["vs_lola_240m"]["rmse_m"], "m RMSE | vs 20m:", (p["vs_lola_20m"]["rmse_m"] if p["vs_lola_20m"] else "N/A"))
    print("Boundary 20m vs 240m RMSE:", rep["lola_20m_vs_240m_boundary"]["rmse_m"], "m")
