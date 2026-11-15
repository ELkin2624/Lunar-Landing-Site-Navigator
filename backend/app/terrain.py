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
                    max_distance_km: float = 250, azimuth_step_deg: int = 1,
                    fine_dem: LolaDem | None = None, fine_distance_km: float = 5) -> tuple[list[HorizonPoint], float]:
    if not 0 <= observer_height_m <= 100:
        raise ValueError("observer_height_m must be between 0 and 100")
    # Massifs 100-200 km away still rise above the 1-2° polar solar path.
    if not 1 <= max_distance_km <= 300 or azimuth_step_deg not in (1, 2, 5, 10):
        raise ValueError("Unsupported ray distance or azimuth step")
    use_fine = False
    if fine_dem is not None:
        try:
            site_height = fine_dem.height_m(site.latitude_deg, site.longitude_deg)
            use_fine = True
        except TerrainError:
            site_height = dem.height_m(site.latitude_deg, site.longitude_deg)
    else:
        site_height = dem.height_m(site.latitude_deg, site.longitude_deg)
    origin_radius = dem.radius_m + site_height + observer_height_m
    profile = []
    # Half-pixel spacing avoids skipping a narrow ridge in a 240 m grid.
    distance_step = dem.scale_m / 2
    maximum_m = max_distance_km * 1000
    near_limit_m = min(maximum_m, fine_distance_km * 1000) if use_fine else 0
    for azimuth in range(0, 360, azimuth_step_deg):
        skyline = -90.0
        obstacle_distance = None
        obstacle_dem = None
        distances = []
        if near_limit_m:
            fine_step = fine_dem.scale_m / 2
            distances.extend(min(index * fine_step, near_limit_m)
                             for index in range(1, math.ceil(near_limit_m / fine_step) + 1))
        distances.extend(min(near_limit_m + index * distance_step, maximum_m)
                         for index in range(1, math.ceil((maximum_m - near_limit_m) / distance_step) + 1))
        for distance in distances:
            lat, lon = _destination(site.latitude_deg, site.longitude_deg, azimuth, distance)
            source_dem = dem
            if distance <= near_limit_m and fine_dem is not None:
                try:
                    height_m = fine_dem.height_m(lat, lon)
                    source_dem = fine_dem
                except TerrainError:
                    height_m = dem.height_m(lat, lon)
            else:
                height_m = dem.height_m(lat, lon)
            terrain_radius = dem.radius_m + height_m
            arc = distance / dem.radius_m
            angle = math.degrees(math.atan2(terrain_radius * math.cos(arc) - origin_radius,
                                            terrain_radius * math.sin(arc)))
            if angle > skyline:
                skyline = angle
                obstacle_distance = distance / 1000
                obstacle_dem = source_dem
        profile.append(HorizonPoint(azimuth_deg=azimuth, elevation_deg=skyline,
                                    obstacle_distance_km=obstacle_distance,
                                    obstacle_source=obstacle_dem.product_id if obstacle_dem else None,
                                    obstacle_pixel_scale_m=obstacle_dem.scale_m if obstacle_dem else None))
    return profile, (site_height + observer_height_m) / 1000


# Empirical 1-sigma vertical RMSE vs 2 m LROC NAC stereo DTMs (VALIDACION_STEREO_NAC.json)
LOLA_20M_VERTICAL_SIGMA_M = 2.7
LOLA_240M_VERTICAL_SIGMA_M = 18.0


def dem_error_envelopes(
    profile: list[HorizonPoint],
    *,
    uses_fine_site: bool = False,
    dem_vertical_error_m: float | None = None,
    sigma_multiplier: float = 3.0,
) -> tuple[list[HorizonPoint], list[HorizonPoint], dict]:
    """Propagate 1-sigma DEM vertical uncertainty to upper/lower skyline error envelopes."""
    obs_sigma = (
        dem_vertical_error_m
        if dem_vertical_error_m is not None
        else (LOLA_20M_VERTICAL_SIGMA_M if uses_fine_site else LOLA_240M_VERTICAL_SIGMA_M)
    )
    upper: list[HorizonPoint] = []
    lower: list[HorizonPoint] = []
    sigma_angles_deg: list[float] = []
    for p in profile:
        is_fine = p.obstacle_pixel_scale_m == 20
        ter_sigma = (
            dem_vertical_error_m
            if dem_vertical_error_m is not None
            else (LOLA_20M_VERTICAL_SIGMA_M if is_fine else LOLA_240M_VERTICAL_SIGMA_M)
        )
        dist_m = max(20.0, (p.obstacle_distance_km or 5.0) * 1000.0)
        # Spatial correlation (Gaussian variogram) prevents unphysical angular blow-up on adjacent cells.
        corr_len_m = 400.0 if (uses_fine_site and is_fine) else 1500.0
        rho = math.exp(-((dist_m / corr_len_m) ** 2))
        sigma_diff_m = math.sqrt(max(0.0, obs_sigma ** 2 + ter_sigma ** 2 - 2.0 * rho * obs_sigma * ter_sigma))
        sigma_ang = math.degrees(math.atan2(sigma_diff_m, dist_m))
        sigma_angles_deg.append(sigma_ang)
        delta = sigma_multiplier * sigma_ang
        upper.append(p.model_copy(update={"elevation_deg": min(90.0, p.elevation_deg + delta)}))
        lower.append(p.model_copy(update={"elevation_deg": max(-90.0, p.elevation_deg - delta)}))

    sorted_s = sorted(sigma_angles_deg)
    median_sigma = sorted_s[len(sorted_s) // 2] if sorted_s else 0.0
    max_sigma = max(sorted_s) if sorted_s else 0.0
    return upper, lower, {
        "dem_vertical_sigma_m": round(obs_sigma, 2),
        "landing_dispersion_sigma": round(sigma_multiplier, 2),
        "horizon_elevation_sigma_deg": round(median_sigma, 4),
        "horizon_envelope_deg": round(sigma_multiplier * median_sigma, 4),
        "max_horizon_envelope_deg": round(sigma_multiplier * max_sigma, 4),
    }
