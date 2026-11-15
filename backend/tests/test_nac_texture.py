import asyncio
from io import BytesIO

import httpx
from PIL import Image

from app.nac_texture import build_texture, build_texture_with_meta, polar_xy


def test_polar_nac_texture_is_georeferenced_and_reports_coverage():
    tile = BytesIO()
    Image.new("RGBA", (256, 256), (120, 140, 160, 255)).save(tile, format="PNG")
    def reply(request):
        assert request.url.host == "trek.nasa.gov"
        assert "/11/" in request.url.path
        return httpx.Response(200, headers={"content-type": "image/png"}, content=tile.getvalue())
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
            return await build_texture(client, -88.3, -59.5, 2000)
    png, pixel_m, coverage = asyncio.run(run())
    image = Image.open(BytesIO(png))
    assert image.width == image.height == round(2000 / pixel_m)
    assert image.getpixel((image.width // 2, image.height // 2))[:3] == (120, 140, 160)
    assert coverage > 0.99
    x, y = polar_xy(-90, 0)
    assert abs(x) < 1e-8 and abs(y) < 1e-8


def test_nac_texture_pixel_mask_and_disk_cache(tmp_path):
    # Half-transparent tile (left half valid, right half alpha=0 no-data)
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    for y in range(256):
        for x in range(128):
            img.putpixel((x, y), (180, 180, 180, 255))
    tile = BytesIO()
    img.save(tile, format="PNG")
    calls = 0

    def reply(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, headers={"content-type": "image/png"}, content=tile.getvalue())

    async def run_first():
        async with httpx.AsyncClient(transport=httpx.MockTransport(reply)) as client:
            return await build_texture_with_meta(client, -88.3, -59.5, 2000, cache_dir=tmp_path)

    def offline_reply(request):
        raise httpx.ConnectError("offline")

    async def run_cached_offline():
        async with httpx.AsyncClient(transport=httpx.MockTransport(offline_reply)) as client:
            return await build_texture_with_meta(client, -88.3, -59.5, 2000, cache_dir=tmp_path)

    _, _, coverage1, hits1, total1 = asyncio.run(run_first())
    assert calls > 0
    assert hits1 == 0
    assert total1 > 0
    assert 0.35 <= coverage1 <= 0.65

    _, _, coverage2, hits2, total2 = asyncio.run(run_cached_offline())
    assert hits2 == total2
    assert coverage2 == coverage1
