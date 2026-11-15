"""Read the public LOLA LDEM_75S_240M PDS3 product and trace a lunar skyline."""

import math
import mmap
from pathlib import Path
import re
import struct

from .models import HorizonPoint, Site

REFERENCE_RADIUS_M = 1_737_400.0
PRODUCT_ID = "LDEM_75S_240M"
FINE_PRODUCT_ID = "LDEM_875S_20M"


class TerrainError(Exception):
    pass


def _label_number(label: str, key: str) -> float:
    match = re.search(rf"^\s*{key}\s*=\s*([-+\d.]+)", label, re.MULTILINE)
    if not match:
        raise TerrainError(f"LOLA label is missing {key}")
    return float(match.group(1))


class LolaDem:
    def __init__(self, image_path: Path):
        self.image_path = image_path
        label_path = image_path.with_suffix(".lbl")
        if not image_path.is_file() or not label_path.is_file():
            raise TerrainError("LOLA IMG and LBL files must be in the same directory")
        label = label_path.read_text(encoding="ascii")
        self.product_id = image_path.stem.upper()
        if self.product_id not in (PRODUCT_ID, FINE_PRODUCT_ID) or f'FILE_NAME                 = "{self.product_id}.IMG"' not in label.upper():
            raise TerrainError("Unsupported LOLA product")
        if 'COORDINATE_SYSTEM_NAME       = "MEAN EARTH/POLAR AXIS OF DE421"' not in label.upper():
            raise TerrainError("Unexpected lunar coordinate frame")
        if "SAMPLE_TYPE           = LSB_INTEGER" not in label.upper() or "SAMPLE_BITS           = 16" not in label.upper():
            raise TerrainError("Unexpected LOLA sample encoding")
        self.size = int(_label_number(label, "LINES"))
        self.scale_m = _label_number(label, "MAP_SCALE")
        self.height_scale = _label_number(label, "SCALING_FACTOR")
        self.radius_m = _label_number(label, "OFFSET")
        expected_size, expected_scale = (3812, 240) if self.product_id == PRODUCT_ID else (7584, 20)
        if self.size != expected_size or self.scale_m != expected_scale or self.radius_m != REFERENCE_RADIUS_M:
            raise TerrainError("Unexpected LOLA grid geometry or reference radius")
        if image_path.stat().st_size != self.size * self.size * 2:
            raise TerrainError("LOLA IMG size does not match its label")
        self._file = image_path.open("rb")
        self._data = mmap.mmap(self._file.fileno(), 0, access=mmap.ACCESS_READ)

    def close(self) -> None:
        self._data.close()
        self._file.close()

    def __enter__(self) -> "LolaDem":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def pixel_index(self, latitude_deg: float, longitude_deg: float) -> tuple[int, int]:
        """Nearest grid cell (row, col) for a geographic coordinate."""
        if latitude_deg > -75 or latitude_deg < -90:
            raise TerrainError("Site or ray is outside the LOLA south pole coverage")
        angular_radius = math.radians(90 + latitude_deg) / 2
        rho = 2 * self.radius_m * math.tan(angular_radius)
        longitude = math.radians(longitude_deg)
        # PDS DSMAP_POLAR: 0°E points to image top; 90°E to image right.
        col = round((self.size - 1) / 2 + rho * math.sin(longitude) / self.scale_m)
        row = round((self.size - 1) / 2 - rho * math.cos(longitude) / self.scale_m)
        if not 0 <= row < self.size or not 0 <= col < self.size:
            raise TerrainError("Site or ray is outside the LOLA image")
        return row, col

    def pixel_height_m(self, row: int, col: int) -> float:
        if not 0 <= row < self.size or not 0 <= col < self.size:
            raise TerrainError("Requested cell is outside the LOLA image")
        dn = struct.unpack_from("<h", self._data, 2 * (row * self.size + col))[0]
        return dn * self.height_scale

    def pixel_ground_spacing_m(self, row: int, col: int) -> float:
        """Ground distance of one grid step at a cell.

        Polar stereographic scale factor k = sec²(c/2), with c the angular
        distance from the pole; one grid step spans MAP_SCALE / k on the sphere.
        """
        dx = (col - (self.size - 1) / 2) * self.scale_m
        dy = (row - (self.size - 1) / 2) * self.scale_m
        half_colatitude = math.atan(math.hypot(dx, dy) / (2 * self.radius_m))
        return self.scale_m * math.cos(half_colatitude) ** 2

    def pixel_longitude_deg(self, row: int, col: int) -> float:
        dx = col - (self.size - 1) / 2
        dy = (self.size - 1) / 2 - row
        return 0.0 if dx == 0 and dy == 0 else math.degrees(math.atan2(dx, dy))

    def height_m(self, latitude_deg: float, longitude_deg: float) -> float:
        return self.pixel_height_m(*self.pixel_index(latitude_deg, longitude_deg))


def _destination(latitude_deg: float, longitude_deg: float, azimuth_deg: float, distance_m: float) -> tuple[float, float]:
    lat = math.radians(latitude_deg)
    lon = math.radians(longitude_deg)
    bearing = math.radians(azimuth_deg)
    arc = distance_m / REFERENCE_RADIUS_M
    end_lat = math.asin(math.sin(lat) * math.cos(arc) + math.cos(lat) * math.sin(arc) * math.cos(bearing))
    end_lon = lon + math.atan2(math.sin(bearing) * math.sin(arc) * math.cos(lat),
                               math.cos(arc) - math.sin(lat) * math.sin(end_lat))
    return math.degrees(end_lat), math.degrees(end_lon)


def horizon_profile(dem: LolaDem, site: Site, *, observer_height_m: float = 2.0,
                    max_distance_km: float = 250, azimuth_step_deg: int = 1) -> tuple[list[HorizonPoint], float]:
    if not 0 <= observer_height_m <= 100:
        raise ValueError("observer_height_m must be between 0 and 100")
    # Massifs 100-200 km away still rise above the 1-2° polar solar path.
    if not 1 <= max_distance_km <= 300 or azimuth_step_deg not in (1, 2, 5, 10):
        raise ValueError("Unsupported ray distance or azimuth step")
    site_height = dem.height_m(site.latitude_deg, site.longitude_deg)
    origin_radius = dem.radius_m + site_height + observer_height_m
    profile = []
    # Half-pixel spacing avoids skipping a narrow ridge in a 240 m grid.
    distance_step = dem.scale_m / 2
    steps = math.ceil(max_distance_km * 1000 / distance_step)
    for azimuth in range(0, 360, azimuth_step_deg):
        skyline = -90.0
        for index in range(1, steps + 1):
            distance = min(index * distance_step, max_distance_km * 1000)
            lat, lon = _destination(site.latitude_deg, site.longitude_deg, azimuth, distance)
            terrain_radius = dem.radius_m + dem.height_m(lat, lon)
            arc = distance / dem.radius_m
            angle = math.degrees(math.atan2(terrain_radius * math.cos(arc) - origin_radius,
                                            terrain_radius * math.sin(arc)))
            skyline = max(skyline, angle)
        profile.append(HorizonPoint(azimuth_deg=azimuth, elevation_deg=skyline))
    return profile, (site_height + observer_height_m) / 1000
