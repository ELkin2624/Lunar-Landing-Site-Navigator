"""Download the public 240 m/pixel LOLA south polar DEM from NASA PDS."""

from pathlib import Path
from urllib.request import urlopen

BASE_URL = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/"
DATA_DIR = Path(__file__).resolve().parents[1] / "data"
FILES = {"ldem_75s_240m.lbl": 4_990, "ldem_75s_240m.img": 29_062_688}


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for name, expected_size in FILES.items():
        target = DATA_DIR / name
        if target.is_file() and target.stat().st_size == expected_size:
            print(f"Already available: {target}")
            continue
        temporary = target.with_suffix(target.suffix + ".part")
        try:
            with urlopen(BASE_URL + name, timeout=120) as response, temporary.open("wb") as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            if temporary.stat().st_size != expected_size:
                raise RuntimeError(f"Unexpected {name} size; expected {expected_size} bytes")
            temporary.replace(target)
            print(f"Downloaded: {target}")
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
