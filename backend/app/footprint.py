"""Local relief evidence from georeferenced LROC NAC stereo DTMs.

This estimates the shape of a configurable square footprint. It cannot detect
boulders, regolith bearing strength, or hazards smaller than the DTM pixels.
"""

import math
from pathlib import Path

from PIL import Image
from pydantic import BaseModel, Field

from .models import Site
from .terrain import REFERENCE_RADIUS_M


class FootprintRequest(BaseModel):
    site: Site
    footprint_m: float = Field(default=20, ge=10, le=100)
    slope_limit_deg: float = Field(default=10, gt=0, lt=45)
    roughness_limit_m: float = Field(default=0.5, gt=0, le=10)


class FootprintResult(BaseModel):
    status: str
    source: str | None
    resolution_m: float | None
    footprint_m: float
    coverage_fraction: float
    sample_count: int
    slope_deg: float | None
    roughness_rms_m: float | None
    residual_peak_m: float | None
    slope_limit_deg: float
    roughness_limit_m: float
    slope_exceeds_limit: bool | None
    roughness_exceeds_limit: bool | None
    rock_hazards: str = "not_evaluated"
    note: str


def _project(site: Site) -> tuple[float, float]:
    rho = 2 * REFERENCE_RADIUS_M * math.tan(math.radians(90 + site.latitude_deg) / 2)
    lon = math.radians(site.longitude_deg)
    return rho * math.sin(lon), rho * math.cos(lon)


def _samples(path: Path, x: float, y: float, width: float) -> tuple[list[tuple[float, float, float]], float, float]:
    with Image.open(path) as image:
        sx, sy, _ = image.tag_v2[33550]
        _, _, _, x0, y0, _ = image.tag_v2[33922]
        if sx <= 0 or sy <= 0 or abs(sx - sy) > 1e-6:
            raise ValueError("Unsupported NAC DTM pixel geometry")
        # Pixel centres only. An incomplete footprint is reported as unknown.
        left = math.ceil((x - width / 2 - x0) / sx - 0.5)
        right = math.floor((x + width / 2 - x0) / sx - 0.5)
        top = math.ceil((y0 - (y + width / 2)) / sy - 0.5)
        bottom = math.floor((y0 - (y - width / 2)) / sy - 0.5)
        total = max(0, right - left + 1) * max(0, bottom - top + 1)
        if not total:
            return [], 0.0, float(sx)
        valid = []
        for row in range(max(0, top), min(image.height - 1, bottom) + 1):
            for col in range(max(0, left), min(image.width - 1, right) + 1):
                z = float(image.getpixel((col, row)))
                if math.isfinite(z) and -100_000 < z < 100_000:
                    px = x0 + (col + 0.5) * sx
                    py = y0 - (row + 0.5) * sy
                    valid.append((px - x, py - y, z))
        return valid, len(valid) / total, float(sx)


def _fit_plane(points: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    mz = sum(p[2] for p in points) / n
    xx = sum((p[0] - mx) ** 2 for p in points)
    yy = sum((p[1] - my) ** 2 for p in points)
    xy = sum((p[0] - mx) * (p[1] - my) for p in points)
    xz = sum((p[0] - mx) * (p[2] - mz) for p in points)
    yz = sum((p[1] - my) * (p[2] - mz) for p in points)
    det = xx * yy - xy * xy
    if det <= 0:
        raise ValueError("Insufficient two-dimensional DTM coverage")
    gx = (xz * yy - yz * xy) / det
    gy = (yz * xx - xz * xy) / det
    residuals = [p[2] - (mz + gx * (p[0] - mx) + gy * (p[1] - my)) for p in points]
    return math.degrees(math.atan(math.hypot(gx, gy))), math.sqrt(sum(v * v for v in residuals) / n), max(map(abs, residuals))


def assess_footprint(request: FootprintRequest, data_dir: Path) -> FootprintResult:
    x, y = _project(request.site)
    best: tuple[str, list[tuple[float, float, float]], float, float] | None = None
    for path in sorted(data_dir.glob("NAC_DTM_*.TIF")):
        try:
            points, coverage, resolution = _samples(path, x, y, request.footprint_m)
        except (OSError, KeyError, ValueError, TypeError):
            continue
        if best is None or coverage > best[2]:
            best = (path.stem, points, coverage, resolution)
    source, points, coverage, resolution = best if best is not None else (None, [], 0.0, None)
    common = dict(source=source, resolution_m=resolution, footprint_m=request.footprint_m,
                  coverage_fraction=round(coverage, 3), sample_count=len(points),
                  slope_limit_deg=request.slope_limit_deg, roughness_limit_m=request.roughness_limit_m)
    if coverage < 0.95 or len(points) < 9 or resolution is None or request.footprint_m / resolution < 5:
        return FootprintResult(status="unknown", slope_deg=None, roughness_rms_m=None,
                               residual_peak_m=None, slope_exceeds_limit=None, roughness_exceeds_limit=None,
                               note="No hay DTM estéreo NAC con cobertura y resolución suficientes para esta huella; no se infiere seguridad.",
                               **common)
    slope, roughness, peak = _fit_plane(points)
    return FootprintResult(status="measured_not_certified", slope_deg=round(slope, 3),
                           roughness_rms_m=round(roughness, 3), residual_peak_m=round(peak, 3),
                           slope_exceeds_limit=slope > request.slope_limit_deg,
                           roughness_exceeds_limit=roughness > request.roughness_limit_m,
                           note="Plano de mejor ajuste sobre DTM NAC; umbrales definidos por el usuario. No evalúa rocas, resistencia del suelo ni despeje del vehículo.",
                           **common)
