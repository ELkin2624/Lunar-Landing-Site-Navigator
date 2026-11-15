from datetime import datetime, timedelta, timezone
import math
from pathlib import Path
import struct

import pytest
from fastapi.testclient import TestClient

from app.analysis import analyze, apply_refined_events, build_timeline, horizon_at
from app.horizons import HorizonsError, parse_ephemeris
from app.main import app
from app.models import BodyPosition, HorizonPoint, Sample, Scenario, Site, TerrainRequest
from app.terrain import LolaDem, _destination, horizon_profile
from app.transitions import effective_step_minutes


def test_parse_horizons_csv():
    result = "header\n$$SOE\n 2026-Nov-15 00:00:00,*, , 114.442858, 1.349506,\n 2026-Nov-15 01:00:00,*, , 113.935287, 1.353515,\n$$EOE\n"
    rows = parse_ephemeris(result)
    assert len(rows) == 2
    assert rows[0] == (datetime(2026, 11, 15, tzinfo=timezone.utc), 114.442858, 1.349506)


def test_horizon_wraparound():
    profile = [HorizonPoint(azimuth_deg=30, elevation_deg=10), HorizonPoint(azimuth_deg=330, elevation_deg=0)]
    assert horizon_at(profile, 0) == 5


class FakeHorizons:
    def __init__(self):
        self.calls = 0

    async def positions(self, body_id, site, start, end, step_minutes):
        self.calls += 1
        elevation = 5 if body_id == 10 else -2
        hours = max(1, int((end - start).total_seconds() / (step_minutes * 60)))
        return [(start + timedelta(minutes=i * step_minutes), 90, elevation) for i in range(hours + 1)]


def test_evaluate_and_validation(monkeypatch, tmp_path):
    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(tmp_path / "not-installed.img"))
    with TestClient(app) as client:
        app.state.horizons = FakeHorizons()
        payload = {
            "site": {"latitude_deg": -89.5, "longitude_deg": 0},
            "start_utc": "2026-11-15T00:00:00Z",
            "end_utc": "2026-11-15T03:00:00Z",
            "step_minutes": 60,
            "constraints": {"min_sunlit_fraction": 1, "min_earth_visible_fraction": 0.5},
        }
        response = client.post("/api/v1/scenarios/evaluate", json=payload)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["metrics"]["sunlit_fraction"] == 1
        assert data["metrics"]["earth_visible_fraction"] == 0
        assert data["metrics"]["longest_earth_blackout_hours"] == 3
        assert data["metrics"]["constraints_met"] is False
        assert data["horizon_source"] == "geometric_0_deg"
        assert len(data["timeline"]["segments"]) == 1
        assert data["timeline"]["events"] == []
        payload["site"]["latitude_deg"] = -91
        assert client.post("/api/v1/scenarios/evaluate", json=payload).status_code == 422


def synthetic_dem(tmp_path: Path) -> Path:
    image = tmp_path / "ldem_75s_240m.img"
    image.with_suffix(".lbl").write_bytes((Path(__file__).parents[1] / "data" / "ldem_75s_240m.lbl").read_bytes())
    with image.open("wb") as output:
        output.truncate(3812 * 3812 * 2)
    return image


def test_lola_projection_and_curved_horizon(tmp_path: Path):
    image = synthetic_dem(tmp_path)
    site = Site(latitude_deg=-89.5, longitude_deg=0)
    with LolaDem(image) as dem:
        assert dem.height_m(-90, 0) == 0
        # A 1 km obstacle 480 m north of the site must block northern sky.
        ridge_lat, ridge_lon = _destination(site.latitude_deg, site.longitude_deg, 0, 480)
        rho = 2 * dem.radius_m * math.tan(math.radians(90 + ridge_lat) / 2)
        row = round((dem.size - 1) / 2 - rho / dem.scale_m)
        col = round((dem.size - 1) / 2)
    with image.open("r+b") as output:
        output.seek(2 * (row * 3812 + col))
        output.write(struct.pack("<h", 2000))
    with LolaDem(image) as dem:
        assert dem.height_m(ridge_lat, ridge_lon) == 1000
        profile, site_height_km = horizon_profile(dem, site, max_distance_km=1, azimuth_step_deg=10)
        assert site_height_km == 0.002
        assert profile[0].elevation_deg > 45
        assert profile[18].elevation_deg < 0


def test_mixed_horizon_tracks_near_fine_obstacle_and_source(tmp_path: Path):
    coarse_path = synthetic_dem(tmp_path)
    fine_path = tmp_path / "ldem_875s_20m.img"
    fine_path.with_suffix(".lbl").write_bytes((Path(__file__).parents[1] / "data" / "ldem_875s_20m.lbl").read_bytes())
    with fine_path.open("wb") as output:
        output.truncate(7584 * 7584 * 2)
    site = Site(latitude_deg=-89.5, longitude_deg=0)
    ridge_lat, ridge_lon = _destination(site.latitude_deg, site.longitude_deg, 0, 100)
    with LolaDem(fine_path) as fine:
        row, col = fine.pixel_index(ridge_lat, ridge_lon)
    with fine_path.open("r+b") as output:
        output.seek(2 * (row * 7584 + col))
        output.write(struct.pack("<h", 2000))
    with LolaDem(coarse_path) as broad, LolaDem(fine_path) as fine:
        profile, _ = horizon_profile(broad, site, max_distance_km=6, azimuth_step_deg=10, fine_dem=fine)
        assert profile[0].elevation_deg > 70
        assert profile[0].obstacle_source == "LDEM_875S_20M"
        assert profile[0].obstacle_pixel_scale_m == 20
        assert profile[0].obstacle_distance_km <= 0.11


def test_distant_massif_beyond_100_km_raises_the_skyline(tmp_path: Path):
    # Near the pole, massifs 100-200 km away can rise above the 1-2° solar path.
    image = synthetic_dem(tmp_path)
    site = Site(latitude_deg=-89.5, longitude_deg=0)
    with LolaDem(image) as dem:
        ridge_lat, _ = _destination(site.latitude_deg, site.longitude_deg, 0, 150_000)
        rho = 2 * dem.radius_m * math.tan(math.radians(90 + ridge_lat) / 2)
        row = round((dem.size - 1) / 2 - rho / dem.scale_m)
        col = round((dem.size - 1) / 2)
    with image.open("r+b") as output:
        output.seek(2 * (row * 3812 + col))
        output.write(struct.pack("<h", 16000))
    with LolaDem(image) as dem:
        near, _ = horizon_profile(dem, site, max_distance_km=100, azimuth_step_deg=10)
        far, _ = horizon_profile(dem, site, azimuth_step_deg=10)
        assert near[0].elevation_deg < 0
        assert far[0].elevation_deg > 0.3
        assert far[18].elevation_deg < 0


def test_horizon_range_defaults_reach_distant_terrain():
    site = {"latitude_deg": -89.5, "longitude_deg": 0}
    assert TerrainRequest(site=site).max_distance_km == 250
    assert TerrainRequest(site=site, max_distance_km=300).max_distance_km == 300
    with pytest.raises(ValueError):
        TerrainRequest(site=site, max_distance_km=301)
    scenario = Scenario(site=site, start_utc="2026-11-15T00:00:00Z", end_utc="2026-11-15T03:00:00Z")
    assert scenario.max_horizon_distance_km == 250


def test_evaluate_with_dem(monkeypatch, tmp_path):
    image = synthetic_dem(tmp_path)
    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(image))
    with TestClient(app) as client:
        app.state.horizons = FakeHorizons()
        payload = {
            "site": {"latitude_deg": -89.5, "longitude_deg": 0},
            "start_utc": "2026-11-15T00:00:00Z",
            "end_utc": "2026-11-15T03:00:00Z",
            "use_dem_horizon": True,
            "max_horizon_distance_km": 1,
        }
        response = client.post("/api/v1/scenarios/evaluate", json=payload)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["horizon_source"] == "LOLA_LDEM_75S_240M_PDS"
        assert data["site_height_km_used"] == 0.002
        assert len(data["horizon_profile"]) == 360
        legacy = client.post("/api/scenarios/analyze", json={
            "latitude": -89.5, "longitude": 0,
            "start_time": "2026-11-15T00:00:00Z", "hours": 3,
            "use_dem_horizon": True, "max_horizon_distance_km": 1,
        })
        assert legacy.status_code == 200, legacy.text
        assert len(legacy.json()["horizon_profile"]) == 360
        assert legacy.json()["samples"][0]["sun_azimuth"] == 90
        assert legacy.json()["samples"][0]["earth_azimuth"] == 90
        assert legacy.json()["ephemeris_source"] == "JPL Horizons"
        assert legacy.json()["dem_pixel_scale_m"] == 240
        assert legacy.json()["transition_uncertainty_minutes"] == 60
        horizon = client.post("/api/v1/terrain/horizon", json={"site": payload["site"], "max_distance_km": 1})
        assert horizon.status_code == 200, horizon.text
        assert len(horizon.json()["profile"]) == 360

        # Test spatial uncertainty recomputes Horizons per cardinal offset
        fake = FakeHorizons()
        app.state.horizons = fake
        unc = client.post("/api/v1/scenarios/evaluate", json={**payload, "spatial_uncertainty_radius_m": 240, "landing_dispersion_sigma": 3.0})
        assert unc.status_code == 200, unc.text
        sp_unc = unc.json()["spatial_uncertainty"]
        assert sp_unc["ephemeris_recomputed_per_offset"] is True
        assert sp_unc["sites_evaluated"] == 5
        assert sp_unc["dem_vertical_sigma_m"] > 0
        assert sp_unc["landing_dispersion_sigma"] == 3.0
        assert sp_unc["horizon_envelope_deg"] > 0
        assert fake.calls == 10  # 2 bodies * (1 center + 4 cardinal offsets)

        # Test legacy refine_transitions + copilot ask
        refined = client.post("/api/scenarios/analyze", json={
            "latitude": -89.5, "longitude": 0,
            "start_time": "2026-11-15T00:00:00Z", "hours": 2,
            "step_minutes": 60, "refine_transitions": True, "refinement_step_minutes": 15,
            "spatial_uncertainty_radius_m": 0,
        })
        assert refined.status_code == 200, refined.text
        assert refined.json()["sampling_minutes"] == 15
        assert len(refined.json()["samples"]) == 8
        assert refined.json()["samples"][1]["hour_offset"] == 0.25

        ask = client.post("/api/v1/copilot/ask", json={"scenario": payload, "user_query": "¿Cuál es la incertidumbre?"})
        assert ask.status_code == 200, ask.text
        assert "incertidumbre" in ask.json()["direct_answer"].lower()


def test_timeline_transitions_and_windows():
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    scenario = Scenario(site=Site(latitude_deg=-89.5, longitude_deg=0), start_utc=start,
                        end_utc=start + timedelta(hours=4), step_minutes=60)

    def body(visible):
        return BodyPosition(azimuth_deg=90, elevation_deg=5 if visible else -5,
                            horizon_deg=0, visible=visible)

    samples = [Sample(time_utc=start + timedelta(hours=hour), sun=body(sun), earth=body(earth))
               for hour, sun, earth in [(0, True, False), (1, False, True),
                                        (2, False, True), (3, True, False)]]
    timeline = build_timeline(scenario, samples)
    metrics = analyze(scenario, timeline)
    assert [(s.start_utc, s.end_utc) for s in timeline.segments] == [
        (start, start + timedelta(hours=1)),
        (start + timedelta(hours=1), start + timedelta(hours=3)),
        (start + timedelta(hours=3), start + timedelta(hours=4)),
    ]
    assert [(event.time_utc, event.kind) for event in timeline.events] == [
        (start + timedelta(hours=1), "sun_visibility_end"),
        (start + timedelta(hours=1), "earth_visibility_start"),
        (start + timedelta(hours=3), "sun_visibility_start"),
        (start + timedelta(hours=3), "earth_visibility_end"),
    ]
    assert timeline.next_sun_visibility_end_utc == start + timedelta(minutes=30)
    assert metrics.sunlit_fraction == 0.5
    assert metrics.earth_visible_fraction == 0.5
    assert metrics.longest_darkness_hours == 2
    assert metrics.longest_earth_blackout_hours == 1
    assert len(metrics.sunlit_windows) == 2


def test_timeline_no_change_within_range():
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    scenario = Scenario(site=Site(latitude_deg=-89.5, longitude_deg=0), start_utc=start,
                        end_utc=start + timedelta(hours=2))
    visible = BodyPosition(azimuth_deg=0, elevation_deg=3, horizon_deg=0, visible=True)
    samples = [Sample(time_utc=start + timedelta(hours=i), sun=visible, earth=visible) for i in range(2)]
    timeline = build_timeline(scenario, samples)
    metrics = analyze(scenario, timeline)
    assert len(timeline.segments) == 1
    assert timeline.events == []
    assert timeline.next_sun_visibility_end_utc is None
    assert metrics.sunlit_windows[0].duration_hours == 2
    assert metrics.earth_visible_windows[0].duration_hours == 2


def test_dense_scan_finds_event_between_coarse_samples(monkeypatch, tmp_path):
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    scenario = Scenario(site=Site(latitude_deg=-89.5, longitude_deg=0), start_utc=start,
                        end_utc=start + timedelta(hours=2), step_minutes=60,
                        refine_transitions=True, refinement_step_minutes=5)
    assert effective_step_minutes(scenario) == 5

    class FineHorizons:
        async def positions(self, body_id, site, query_start, query_end, step_minutes):
            assert step_minutes == 5
            return [(query_start + timedelta(minutes=minute), 90,
                     -1 if body_id == 10 and minute in (20, 25) else 1)
                    for minute in range(0, 121, 5)]

    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(tmp_path / "not-installed.img"))
    with TestClient(app) as client:
        app.state.horizons = FineHorizons()
        response = client.post("/api/v1/scenarios/evaluate", json=scenario.model_dump(mode="json"))
    assert response.status_code == 200, response.text
    data = response.json()
    events = data["timeline"]["events"]
    assert [event["kind"] for event in events] == ["sun_visibility_end", "sun_visibility_start"]
    assert events[0]["estimated_time_utc"] == "2026-11-15T00:17:30Z"
    assert events[1]["estimated_time_utc"] == "2026-11-15T00:27:30Z"
    assert data["metrics"]["longest_darkness_hours"] == pytest.approx(1 / 6)
    assert data["timeline"]["transition_resolution_minutes"] == 5


def test_dense_scan_limit():
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)
    scenario = Scenario(site=Site(latitude_deg=-89.5, longitude_deg=0), start_utc=start,
                        end_utc=start + timedelta(days=14), step_minutes=60,
                        refine_transitions=True, refinement_step_minutes=1)
    with pytest.raises(ValueError, match="limit is 5000"):
        effective_step_minutes(scenario)


def test_comms_simulation_endpoint(monkeypatch, tmp_path):
    start = datetime(2026, 11, 15, tzinfo=timezone.utc)

    class FakeCommsHorizons:
        async def positions(self, body_id, site, query_start, query_end, step_minutes):
            out = []
            cur = query_start
            i = 0
            while cur <= query_end:
                # Earth visible first half, occulted second half
                el = 6.0 if (body_id == 399 and i < 12) else (-4.0 if body_id == 399 else 4.0)
                out.append((cur, 0.0, el))
                cur += timedelta(minutes=step_minutes)
                i += 1
            return out

    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(tmp_path / "not-installed.img"))
    with TestClient(app) as client:
        app.state.horizons = FakeCommsHorizons()
        res = client.post(
            "/api/v1/simulation/comms",
            json={
                "scenario": {
                    "site": {"latitude_deg": -89.5, "longitude_deg": 0.0, "label": "Test Comms"},
                    "start_utc": start.isoformat(),
                    "end_utc": (start + timedelta(hours=24)).isoformat(),
                    "step_minutes": 60,
                },
                "config": {
                    "band": "X",
                    "peak_downlink_mbps": 10.0,
                    "min_grazing_deg": 2.0,
                    "daily_data_generation_gb": 16.0,
                    "buffer_capacity_gb": 20.0,
                },
            },
        )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["config"]["band"] == "X"
    assert len(body["steps"]) == 24
    assert body["total_generated_gb"] == pytest.approx(16.0, abs=0.1)
    assert body["total_downlinked_gb"] > 0.0
    assert body["nominal_link_percent"] == 50.0
    assert body["comms_viable"] is True

