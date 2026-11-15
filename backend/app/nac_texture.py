"""Build a georeferenced local NAC texture from Moon Trek polar WMTS tiles."""

import asyncio
from io import BytesIO
import math
import os
from pathlib import Path

import httpx
from PIL import Image

from .terrain import REFERENCE_RADIUS_M

LAYER = "LRO_NAC_Mosaic_SPole85.5_1mp"
WMTS = f"https://trek.nasa.gov/tiles/Moon/SP/{LAYER}/1.0.0/default/default028mm"
ORIGIN_M = 1_095_930
SCALE_AT_FIVE_M = 955_575.1255580344 * 0.00028
LAYER_BOUND_M = 136_526
WAC_IMAGE = Path(__file__).resolve().parents[2] / "frontend" / "public" / "lroc_wac_south_pole.png"
DEFAULT_CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "nac_cache"


def polar_xy(latitude_deg: float, longitude_deg: float) -> tuple[float, float]:
    radius = 2 * REFERENCE_RADIUS_M * math.tan(math.radians(90 + latitude_deg) / 2)
    longitude = math.radians(longitude_deg)
    return radius * math.sin(longitude), radius * math.cos(longitude)


def _cache_enabled() -> bool:
    return os.getenv("LUNARPATH_NAC_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")


async def build_texture_with_meta(
    client: httpx.AsyncClient,
    latitude_deg: float,
    longitude_deg: float,
    span_m: int,
    *,
    cache_dir: Path | None = DEFAULT_CACHE_DIR,
) -> tuple[bytes, float, float, int, int]:
    """Return PNG, delivered tile resolution, pixel-level coverage fraction, cache hits, and requested tile count.

    Uses each tile's alpha channel to measure pixel-level valid coverage instead of assuming full 256x256 coverage,
    and caches downloaded tiles locally so repeat or offline views work without re-fetching Moon Trek.
    """
    center_x, center_y = polar_xy(latitude_deg, longitude_deg)
    zoom = 11 if span_m <= 2500 else 9
    pixel_m = SCALE_AT_FIVE_M * 2 ** (5 - zoom)
    size = round(span_m / pixel_m)
    left = center_x - span_m / 2
    top = center_y + span_m / 2
    right = center_x + span_m / 2
    bottom = center_y - span_m / 2
    if left >= LAYER_BOUND_M or right <= -LAYER_BOUND_M or bottom >= LAYER_BOUND_M or top <= -LAYER_BOUND_M:
        raise ValueError("NAC mosaic has no coverage at this location")
    tile_span = 256 * pixel_m
    cols = range(math.floor((left + ORIGIN_M) / tile_span), math.floor((right + ORIGIN_M) / tile_span) + 1)
    rows = range(math.floor((ORIGIN_M - top) / tile_span), math.floor((ORIGIN_M - bottom) / tile_span) + 1)
    requests = [(row, col) for row in rows for col in cols]
    if len(requests) > 25:
        raise ValueError("Requested texture needs too many tiles")

    active_cache = cache_dir if (cache_dir is not None and _cache_enabled()) else None

    async def tile(row: int, col: int):
        tile_left = -ORIGIN_M + col * tile_span
        tile_top = ORIGIN_M - row * tile_span
        if tile_left >= LAYER_BOUND_M or tile_left + tile_span <= -LAYER_BOUND_M or tile_top <= -LAYER_BOUND_M or tile_top - tile_span >= LAYER_BOUND_M:
            return row, col, None, False
        cache_file = (active_cache / str(zoom) / f"{row}_{col}.png") if active_cache else None
        if cache_file is not None and cache_file.is_file():
            try:
                return row, col, Image.open(cache_file).convert("RGBA"), True
            except OSError:
                pass
        try:
            response = await client.get(f"{WMTS}/{zoom}/{row}/{col}.png")
            if response.status_code == 200 and response.headers.get("content-type", "").startswith("image/"):
                img = Image.open(BytesIO(response.content)).convert("RGBA")
                if cache_file is not None:
                    try:
                        cache_file.parent.mkdir(parents=True, exist_ok=True)
                        cache_file.write_bytes(response.content)
                    except OSError:
                        pass
                return row, col, img, False
        except (httpx.HTTPError, OSError):
            pass
        return row, col, None, False

    tiles = await asyncio.gather(*(tile(row, col) for row, col in requests))
    if WAC_IMAGE.is_file():
        with Image.open(WAC_IMAGE) as wac:
            wac = wac.convert("RGBA")
            width, height = wac.size
            box = (
                (left + 192_000) / 384_000 * width,
                (192_000 - top) / 384_000 * height,
                (right + 192_000) / 384_000 * width,
                (192_000 - bottom) / 384_000 * height,
            )
            canvas = wac.crop(box).resize((size, size), Image.Resampling.BILINEAR)
    else:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 255))

    mask = Image.new("L", (size, size), 0)
    cache_hits = 0
    delivered_tiles = 0
    for row, col, image, from_cache in tiles:
        if image is None:
            continue
        delivered_tiles += 1
        if from_cache:
            cache_hits += 1
        tile_left = -ORIGIN_M + col * tile_span
        tile_top = ORIGIN_M - row * tile_span
        x = round((tile_left - left) / pixel_m)
        y = round((top - tile_top) / pixel_m)
        canvas.paste(image, (x, y), image)
        # Pixel-level coverage mask: only count non-transparent pixels inside the delivered tile.
        alpha_mask = image.getchannel("A").point(lambda a: 255 if a > 0 else 0)
        mask.paste(alpha_mask, (x, y), alpha_mask)

    fraction = mask.histogram()[255] / (size * size)
    if fraction == 0:
        raise ValueError("NAC tiles are unavailable for this location")
    output = BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue(), pixel_m, min(1.0, fraction), cache_hits, delivered_tiles


async def build_texture(
    client: httpx.AsyncClient,
    latitude_deg: float,
    longitude_deg: float,
    span_m: int,
    *,
    cache_dir: Path | None = None,
) -> tuple[bytes, float, float]:
    png, pixel_m, coverage, _, _ = await build_texture_with_meta(
        client, latitude_deg, longitude_deg, span_m, cache_dir=cache_dir
    )
    return png, pixel_m, coverage
