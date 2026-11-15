from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image, TiffImagePlugin

from app.footprint import FootprintRequest, _fit_plane, assess_footprint
from app.comms import CommsConfig, simulate_comms
from app.link_budget import LinkBudgetRequest, calculate_link_budget
from app.main import app
from app.models import Site


def test_local_plane_fit_separates_slope_from_roughness():
    points = [(x, y, 0.1 * x + 0.2 * y + 1000) for x in range(-10, 11, 2) for y in range(-10, 11, 2)]
    slope, roughness, peak = _fit_plane(points)
    assert abs(slope - 12.604) < 0.01
    assert roughness < 1e-9
    assert peak < 1e-9


def test_local_footprint_without_stereo_data_is_unknown(tmp_path: Path):
    site = Site(latitude_deg=-84.6, longitude_deg=31)
    result = assess_footprint(FootprintRequest(site=site), tmp_path)
    assert result.status == "unknown"
    assert result.slope_deg is None
    assert result.rock_hazards == "not_evaluated"


def test_georeferenced_stereo_footprint_reports_plane_and_coverage(tmp_path: Path):
    image = Image.new("F", (101, 101))
    image.putdata([1000 + 0.1 * (-101 + (col + 0.5) * 2) + 0.2 * (101 - (row + 0.5) * 2)
                   for row in range(101) for col in range(101)])
    tags = TiffImagePlugin.ImageFileDirectory_v2()
    tags[33550] = (2.0, 2.0, 0.0)
    tags[33922] = (0.0, 0.0, 0.0, -101.0, 101.0, 0.0)
    image.save(tmp_path / "NAC_DTM_SYN.TIF", tiffinfo=tags)
    result = assess_footprint(FootprintRequest(site=Site(latitude_deg=-90, longitude_deg=0)), tmp_path)
    assert result.status == "measured_not_certified"
    assert result.coverage_fraction == 1
    assert abs(result.slope_deg - 12.604) < 0.02
    assert result.roughness_rms_m < 0.001
    assert result.rock_hazards == "not_evaluated"


def test_link_budget_range_and_rate_sensitivity():
    base = LinkBudgetRequest(spacecraft_eirp_dbw=30, ground_station_gt_dbk=50, target_rate_mbps=10)
    result = calculate_link_budget(base)
    faster = calculate_link_budget(base.model_copy(update={"target_rate_mbps": 100}))
    more_loss = calculate_link_budget(base.model_copy(update={"other_losses_db": 13}))
    assert result.margin_db - faster.margin_db == 10
    assert result.margin_db - more_loss.margin_db == 10
    assert result.max_rate_mbps_at_required_margin > 0


def test_earth_disk_fraction_is_not_an_unsupported_data_rate_factor():
    instant = datetime(2027, 1, 1, tzinfo=timezone.utc)
    earth = SimpleNamespace(visible=True, elevation_deg=3, horizon_deg=0, disk_fraction=0.2)
    scenario = SimpleNamespace(samples=[SimpleNamespace(time_utc=instant, earth=earth)],
                               scenario=SimpleNamespace(step_minutes=60))
    config = CommsConfig(peak_downlink_mbps=10, min_grazing_deg=2)
    result = simulate_comms(scenario, config)
    assert result.steps[0].effective_rate_mbps == 10
    assert result.operational_link_verified is False
    earth.elevation_deg = 1
    assert simulate_comms(scenario, config).steps[0].effective_rate_mbps == 0


def test_status_and_footprint_api():
    with TestClient(app) as client:
        availability = client.get("/api/v1/data/availability")
        assert availability.status_code == 200
        assert availability.json()["horizons_status"] == "checked_per_request"
        response = client.post("/api/v1/terrain/footprint", json={"site": {"latitude_deg": -84.6, "longitude_deg": 31}})
        assert response.status_code == 200
        assert response.json()["status"] == "unknown"
        budget = client.post("/api/v1/comms/link-budget", json={
            "spacecraft_eirp_dbw": 30, "ground_station_gt_dbk": 50, "target_rate_mbps": 10,
        })
        assert budget.status_code == 200
        assert "margin_db" in budget.json()
