"""Render a small georeferenced relief preview from the local PDS LOLA DEM.

Run from the repository root after placing ldem_75s_240m.img and .lbl in
backend/data. The source DEM is excluded from git; the generated PNG is small.
"""

from pathlib import Path
import math
import mmap
import struct
import zlib


ROOT = Path(__file__).resolve().parents[2]
DEM = ROOT / "backend/data/ldem_75s_240m.img"
LABEL = DEM.with_suffix(".lbl")
OUT = ROOT / "frontend/public/lola_south_pole.png"
DEM_SIZE = 3812
SOURCE_HALF_WIDTH = 800  # DEM pixels from the pole; 192 km on each side.
OUTPUT_SIZE = 800


def chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload))


def main() -> None:
    label = LABEL.read_text(encoding="ascii")
    if 'MAP_PROJECTION_TYPE          = "POLAR STEREOGRAPHIC"' not in label:
        raise ValueError("Expected the LOLA south polar stereographic product")
    if DEM.stat().st_size != DEM_SIZE * DEM_SIZE * 2:
        raise ValueError("Unexpected LOLA image size")

    first = round((DEM_SIZE - 1) / 2) - SOURCE_HALF_WIDTH
    step = SOURCE_HALF_WIDTH * 2 / OUTPUT_SIZE
    raw = bytearray()
    with DEM.open("rb") as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
        def height(row: int, col: int) -> float:
            return struct.unpack_from("<h", data, 2 * (row * DEM_SIZE + col))[0] * 0.5

        for y in range(OUTPUT_SIZE):
            raw.append(0)  # PNG filter: none
            row = first + round((y + 0.5) * step)
            for x in range(OUTPUT_SIZE):
                col = first + round((x + 0.5) * step)
                elevation = height(row, col)
                dx = (height(row, col + 2) - height(row, col - 2)) / (4 * 240)
                dy = (height(row + 2, col) - height(row - 2, col)) / (4 * 240)
                illumination = (0.65 - 0.7 * dx - 0.55 * dy) / math.sqrt(1 + dx * dx + dy * dy)
                gray = max(35, min(210, round(77 + 115 * illumination + elevation * 0.004)))
                raw.extend((max(0, gray - 8), gray, min(255, gray + 5)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    header = struct.pack(">IIBBBBB", OUTPUT_SIZE, OUTPUT_SIZE, 8, 2, 0, 0, 0)
    OUT.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    print(f"Wrote {OUT} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
