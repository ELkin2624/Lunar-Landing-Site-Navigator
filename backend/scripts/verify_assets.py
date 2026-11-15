"""Preflight scientific raster assets before starting a public deployment."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

from app.terrain import LolaDem, TerrainError

DATA = Path(__file__).resolve().parents[1] / "data"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="require fine LOLA and both bundled NAC stereo products")
    args = parser.parse_args()
    report = {"required_ok": True, "assets": []}
    for stem, required in (("ldem_75s_240m", True), ("ldem_875s_20m", args.strict)):
        image = DATA / f"{stem}.img"
        label = DATA / f"{stem}.lbl"
        item = {"product": stem, "required": required, "available": image.is_file() and label.is_file()}
        if item["available"]:
            try:
                with LolaDem(image) as dem:
                    item.update(pixel_scale_m=dem.scale_m, center_height_m=dem.height_m(-90, 0),
                                image_sha256=sha256(image), label_sha256=sha256(label))
            except (TerrainError, OSError) as exc:
                item.update(available=False, error=str(exc))
        if required and not item["available"]:
            report["required_ok"] = False
        report["assets"].append(item)
    for stem in ("NAC_DTM_ESALL_CR1", "NAC_DTM_ESALL_MP1"):
        path = DATA / "nac_dtm" / f"{stem}.TIF"
        item = {"product": stem, "required": args.strict, "available": path.is_file()}
        if item["available"]:
            try:
                with Image.open(path) as image:
                    item.update(size_px=image.size, pixel_scale_m=image.tag_v2[33550][0],
                                image_sha256=sha256(path))
            except (OSError, KeyError, TypeError) as exc:
                item.update(available=False, error=str(exc))
        if args.strict and not item["available"]:
            report["required_ok"] = False
        report["assets"].append(item)
    print(json.dumps(report, indent=2))
    raise SystemExit(0 if report["required_ok"] else 1)


if __name__ == "__main__":
    main()
