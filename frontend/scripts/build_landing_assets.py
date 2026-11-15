"""Build landing-page Moon textures and a bright-star catalog from NASA/ESA sources.

Inputs (download into one folder):
  https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_4k.tif  (LROC color, CGI Moon Kit)
  https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif              (LOLA heights in km)
  https://cdn.jsdelivr.net/npm/d3-celestial@0.7.35/data/stars.6.json             (Hipparcos to mag 6)

Usage: python scripts/build_landing_assets.py <input-folder> public/landing
Requires numpy and pillow.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
src, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
R_M = 1_737_400.0

# Color: LROC WAC mosaic with poles filled (CGI Moon Kit, NASA SVS 4720).
color = Image.open(src / 'lroc_color_poles_4k.tif').convert('RGB')
color.save(out / 'moon_color_4k.jpg', quality=84, optimize=True, progressive=True)
color.resize((2048, 1024), Image.LANCZOS).save(out / 'moon_color_2k.jpg', quality=84, optimize=True, progressive=True)

# Relief: LOLA heights in km (ldem_16, 16 px/deg) -> tangent-space normal map for an equirectangular sphere.
dem = np.asarray(Image.open(src / 'ldem_16.tif'), dtype=np.float32) * 1000.0
W, H = 4096, 2048
dem = np.asarray(Image.fromarray(dem).resize((W, H), Image.BILINEAR), dtype=np.float64)
lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
# Near the poles one longitude pixel spans far less ground than one latitude pixel. Box-blur each row
# along longitude to the equivalent width so the relief stays isotropic instead of streaking radially.
for row in range(H):
    k = int(min(W // 8, max(1, round(1 / max(np.cos(lat[row]), 1e-3)))))
    if k > 1:
        padded = np.concatenate([dem[row, -k:], dem[row], dem[row, :k]])
        c = np.cumsum(np.insert(padded, 0, 0.0))
        dem[row] = ((c[2 * k:] - c[:-2 * k]) / (2 * k))[:W]
cos_lat = np.maximum(np.cos(lat), 0.04)[:, None]
dx = 2 * np.pi * R_M * cos_lat / W
dy = np.pi * R_M / H
gx = (np.roll(dem, -1, axis=1) - np.roll(dem, 1, axis=1)) / (2 * dx)
north = np.vstack([dem[:1], dem[:-1]]); south = np.vstack([dem[1:], dem[-1:]])
gy = (north - south) / (2 * dy)
exaggeration = 4.0
n = np.dstack([-gx * exaggeration, -gy * exaggeration, np.ones_like(dem)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
normal_map = Image.fromarray(((n * 0.5 + 0.5) * 255).round().astype(np.uint8))
normal_map.save(out / 'moon_normal_4k.jpg', quality=88, optimize=True)
normal_map.resize((2048, 1024), Image.LANCZOS).save(out / 'moon_normal_2k.jpg', quality=88, optimize=True)

# Stars: Hipparcos stars to magnitude 6 (d3-celestial stars.6.json) as [ra_deg, dec_deg, mag, b-v].
stars = json.loads((src / 'stars.6.json').read_text())
rows = []
for f in stars['features']:
    ra, dec = f['geometry']['coordinates']
    p = f['properties']
    bv = p.get('bv'); bv = float(bv) if bv not in (None, '') else 0.6
    rows.append([round(ra % 360, 3), round(dec, 3), round(float(p['mag']), 2), round(bv, 2)])
(out / 'stars_hip6.json').write_text(json.dumps({'source': 'Hipparcos via d3-celestial stars.6.json', 'fields': ['ra_deg', 'dec_deg', 'mag', 'bv'], 'stars': rows}, separators=(',', ':')))
for p in sorted(out.iterdir()):
    print(p.name, round(p.stat().st_size / 1e6, 2), 'MB')
