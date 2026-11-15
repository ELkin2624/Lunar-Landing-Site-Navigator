"""Generate lightweight LOD GLB assets from the full planetary GLBs without modifying originals."""

from __future__ import annotations

import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public"
ASSETS = [
    (ROOT / "luna" / "luna_cientifica.glb", ROOT / "luna" / "luna_lod.glb", 768, 78),
    (ROOT / "sol" / "sol_cientifico.glb", ROOT / "sol" / "sol_lod.glb", 512, 76),
    (ROOT / "tierra" / "tierra_cientifica.glb", ROOT / "tierra" / "tierra_lod.glb", 768, 78),
]


def _read_glb(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    jlen, jtype = struct.unpack("<II", raw[12:20])
    assert jtype == 0x4E4F534A
    gltf = json.loads(raw[20 : 20 + jlen].decode("utf-8"))
    blen, btype = struct.unpack("<II", raw[20 + jlen : 28 + jlen])
    assert btype == 0x004E4942
    bin_data = raw[28 + jlen : 28 + jlen + blen]
    return gltf, bin_data


def _downsample_webp(blob: bytes, max_width: int, quality: int) -> bytes:
    with Image.open(io.BytesIO(blob)) as img:
        w, h = img.size
        if w > max_width:
            new_h = max(1, round(h * max_width / w))
            img = img.resize((max_width, new_h), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=quality, method=6)
        return out.getvalue()


def _extract_radius_grid(gltf: dict, bin_data: bytes, n_u: int, n_v: int) -> np.ndarray:
    prim = gltf["meshes"][0]["primitives"][0]
    pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
    bv = gltf["bufferViews"][pos_acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + pos_acc.get("byteOffset", 0)
    pos = np.frombuffer(bin_data, dtype=np.float32, count=pos_acc["count"] * 3, offset=offset).reshape(-1, 3)

    r = np.linalg.norm(pos, axis=1)
    safe_r = np.maximum(r, 1e-6)
    u = (np.arctan2(pos[:, 2], -pos[:, 0]) / (2.0 * math.pi)) % 1.0
    v = np.arccos(np.clip(pos[:, 1] / safe_r, -1.0, 1.0)) / math.pi

    grid_sum = np.zeros((n_v + 1, n_u), dtype=np.float64)
    grid_cnt = np.zeros((n_v + 1, n_u), dtype=np.int32)
    ui = np.clip((u * n_u).astype(np.int32) % n_u, 0, n_u - 1)
    vi = np.clip(np.rint(v * n_v).astype(np.int32), 0, n_v)
    np.add.at(grid_sum, (vi, ui), r)
    np.add.at(grid_cnt, (vi, ui), 1)

    mean_r = float(np.mean(r))
    radii = np.where(grid_cnt > 0, grid_sum / np.maximum(grid_cnt, 1), mean_r)
    # Periodic wrap for seam column n_u
    return np.concatenate([radii, radii[:, :1]], axis=1)


def _build_sphere_buffers(radii: np.ndarray, n_u: int, n_v: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    us = np.linspace(0.0, 1.0, n_u + 1, dtype=np.float64)
    vs = np.linspace(0.0, 1.0, n_v + 1, dtype=np.float64)
    uu, vv = np.meshgrid(us, vs)

    lon = uu * (2.0 * math.pi)
    lat = vv * math.pi
    sin_lat = np.sin(lat)
    # Match original spherical mapping: u = atan2(z, -x)/(2*pi) -> x = -sin(lat)*cos(lon), z = sin(lat)*sin(lon)
    dx = -sin_lat * np.cos(lon)
    dy = np.cos(lat)
    dz = sin_lat * np.sin(lon)

    px = (radii * dx).astype(np.float32)
    py = (radii * dy).astype(np.float32)
    pz = (radii * dz).astype(np.float32)

    positions = np.stack([px, py, pz], axis=-1).reshape(-1, 3).astype(np.float32)
    normals = np.stack([dx, dy, dz], axis=-1).reshape(-1, 3).astype(np.float32)
    uvs = np.stack([uu, vv], axis=-1).reshape(-1, 2).astype(np.float32)

    indices: list[int] = []
    stride = n_u + 1
    for r in range(n_v):
        for c in range(n_u):
            a = r * stride + c
            b = a + stride
            indices.extend([a, b, a + 1, a + 1, b, b + 1])
    return positions, normals, uvs, np.array(indices, dtype=np.uint16)


def build_lod(src: Path, dst: Path, max_tex_width: int, tex_quality: int, n_u: int = 72, n_v: int = 36) -> None:
    gltf, bin_data = _read_glb(src)
    radii = _extract_radius_grid(gltf, bin_data, n_u, n_v)
    positions, normals, uvs, indices = _build_sphere_buffers(radii, n_u, n_v)

    pos_bytes = positions.tobytes()
    norm_bytes = normals.tobytes()
    uv_bytes = uvs.tobytes()
    idx_bytes = indices.tobytes()
    if len(idx_bytes) % 4 != 0:
        idx_bytes += b"\x00" * (4 - len(idx_bytes) % 4)

    img_blobs: list[bytes] = []
    for img in gltf.get("images", []):
        bv = gltf["bufferViews"][img["bufferView"]]
        raw_img = bin_data[bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv["byteLength"]]
        small_img = _downsample_webp(raw_img, max_tex_width, tex_quality)
        img_blobs.append(small_img)

    chunks = [pos_bytes, norm_bytes, uv_bytes, idx_bytes] + img_blobs
    buffer_views = []
    offset = 0
    for idx_chunk, chunk in enumerate(chunks):
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(chunk)}
        if idx_chunk < 3:
            bv["target"] = 34962
        elif idx_chunk == 3:
            bv["target"] = 34963
        buffer_views.append(bv)
        offset += len(chunk)
        pad = (4 - len(chunk) % 4) % 4
        if pad:
            chunks[idx_chunk] = chunk + (b"\x00" * pad)
            offset += pad

    new_images = []
    for idx, img in enumerate(gltf.get("images", [])):
        new_images.append({"bufferView": 4 + idx, "mimeType": "image/webp"})

    v_count = len(positions)
    i_count = len(indices)
    pmin = positions.min(axis=0).astype(float).tolist()
    pmax = positions.max(axis=0).astype(float).tolist()

    # Preserve material without normal-map requirement on TANGENT-less LOD geometry (clean shading)
    new_materials = []
    for mat in gltf.get("materials", []):
        m_copy = json.loads(json.dumps(mat))
        new_materials.append(m_copy)

    out_gltf = {
        "asset": {"version": "2.0", "generator": "LunarPath LOD Optimizer"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": gltf.get("nodes", [{"mesh": 0}]),
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
                        "indices": 3,
                        "material": 0,
                    }
                ]
            }
        ],
        "materials": new_materials,
        "textures": gltf.get("textures", []),
        "samplers": gltf.get("samplers", []),
        "images": new_images,
        "extensionsUsed": gltf.get("extensionsUsed", []),
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": v_count, "type": "VEC3", "min": pmin, "max": pmax},
            {"bufferView": 1, "componentType": 5126, "count": v_count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": v_count, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5123, "count": i_count, "type": "SCALAR"},
        ],
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": offset}],
    }
    if not out_gltf["extensionsUsed"]:
        out_gltf.pop("extensionsUsed", None)

    json_bytes = json.dumps(out_gltf, separators=(",", ":")).encode("utf-8")
    j_pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * j_pad

    bin_all = b"".join(chunks)
    total_len = 12 + 8 + len(json_bytes) + 8 + len(bin_all)

    with dst.open("wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_all), 0x004E4942))
        f.write(bin_all)

    print(f"{src.name} ({src.stat().st_size / 1024:.1f} KB) -> {dst.name} ({dst.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    for src, dst, w, q in ASSETS:
        build_lod(src, dst, w, q)
