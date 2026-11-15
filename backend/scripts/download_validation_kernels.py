"""Download the kernels required by validate_spice.py from NAIF and ESA."""

from pathlib import Path
from urllib.request import urlopen

TARGET = Path(__file__).resolve().parents[1] / "data" / "kernels"
FILES = {
    "naif0012.tls": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "moon_pa_de440_200625.bpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf",
    "inpop19a_19900101_20500101.bsp": "https://spiftp.esac.esa.int/data/SPICE/JUICE/kernels/spk/inpop19a_19900101_20500101.bsp",
}


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        target = TARGET / name
        if target.is_file() and target.stat().st_size > 1000:
            print(f"Already available: {target}")
            continue
        temporary = target.with_suffix(target.suffix + ".part")
        try:
            with urlopen(url, timeout=120) as response, temporary.open("wb") as output:
                while block := response.read(1024 * 1024):
                    output.write(block)
            if temporary.stat().st_size < 1000:
                raise RuntimeError(f"Empty or truncated kernel: {name}")
            temporary.replace(target)
            print(f"Downloaded: {target}")
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
