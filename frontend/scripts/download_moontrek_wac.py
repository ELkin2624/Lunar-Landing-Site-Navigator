"""Cache a georeferenced LROC WAC south-pole preview from NASA Moon Trek WMTS.

Requires Pillow (`python -m pip install Pillow`). This preview uses the same
384 km square and 800 px output grid as generate_polar_map.py. The source is
the Moon Trek LRO WAC South Pole v2 layer, not a time-specific illumination map.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from math import floor
from pathlib import Path
from urllib.request import Request, urlopen

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/lroc_wac_south_pole.png"
ENDPOINT = "https://trek.nasa.gov/tiles/Moon/SP/LRO_WAC_Mosaic_SPole60_100m_v02/1.0.0/default/default028mm"
ZOOM = 5
TILE_SIZE = 256
# From this layer's WMTS GetCapabilities TileMatrix 5.
TOP_LEFT_X = -1_095_930.0
TOP_LEFT_Y = 1_095_930.0
SCALE_DENOMINATOR = 955_575.1255580344
METERS_PER_PIXEL = SCALE_DENOMINATOR * 0.00028
HALF_WIDTH_M = 192_000.0
OUTPUT_SIZE = 800


def fetch_tile(row: int, col: int) -> tuple[int, int, Image.Image]:
    url = f"{ENDPOINT}/{ZOOM}/{row}/{col}.png"
    request = Request(url, headers={"User-Agent": "LunarPathAI/0.1 (NASA Space Apps educational map)"})
    with urlopen(request, timeout=30) as response:
        tile = Image.open(BytesIO(response.read())).convert("RGBA")
        tile.load()
    if tile.size != (TILE_SIZE, TILE_SIZE):
        raise ValueError(f"Unexpected tile size at {url}: {tile.size}")
    return row, col, tile


def main() -> None:
    left = (-HALF_WIDTH_M - TOP_LEFT_X) / METERS_PER_PIXEL
    right = (HALF_WIDTH_M - TOP_LEFT_X) / METERS_PER_PIXEL
    top = (TOP_LEFT_Y - HALF_WIDTH_M) / METERS_PER_PIXEL
    bottom = (TOP_LEFT_Y + HALF_WIDTH_M) / METERS_PER_PIXEL
    first_col, last_col = floor(left / TILE_SIZE), floor(right / TILE_SIZE)
    first_row, last_row = floor(top / TILE_SIZE), floor(bottom / TILE_SIZE)
    columns = last_col - first_col + 1
    rows = last_row - first_row + 1
    mosaic = Image.new("RGBA", (columns * TILE_SIZE, rows * TILE_SIZE), "#17212b")

    with ThreadPoolExecutor(max_workers=4) as pool:
        jobs = [pool.submit(fetch_tile, row, col)
                for row in range(first_row, last_row + 1)
                for col in range(first_col, last_col + 1)]
        for job in as_completed(jobs):
            row, col, tile = job.result()
            mosaic.alpha_composite(tile, ((col - first_col) * TILE_SIZE, (row - first_row) * TILE_SIZE))

    bounds = (left - first_col * TILE_SIZE, top - first_row * TILE_SIZE,
              right - first_col * TILE_SIZE, bottom - first_row * TILE_SIZE)
    preview = mosaic.crop(bounds).resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS).convert("RGB")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    preview.save(OUT, optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes) from {len(jobs)} WMTS tiles")


if __name__ == "__main__":
    main()
