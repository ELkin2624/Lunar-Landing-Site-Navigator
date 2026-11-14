from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.analysis import horizon_at
from app.horizons import HorizonsError, parse_ephemeris
from app.main import app
from app.models import HorizonPoint


def test_parse_horizons_csv():
    result = "header\n$$SOE\n 2026-Nov-15 00:00:00,*, , 114.442858, 1.349506,\n 2026-Nov-15 01:00:00,*, , 113.935287, 1.353515,\n$$EOE\n"
    rows = parse_ephemeris(result)
    assert len(rows) == 2
    assert rows[0] == (datetime(2026, 11, 15, tzinfo=timezone.utc), 114.442858, 1.349506)


def test_horizon_wraparound():
    profile = [HorizonPoint(azimuth_deg=30, elevation_deg=10), HorizonPoint(azimuth_deg=330, elevation_deg=0)]
    assert horizon_at(profile, 0) == 5


class FakeHorizons:
    async def positions(self, body_id, site, start, end, step_minutes):
        elevation = 5 if body_id == 10 else -2
        return [(start + timedelta(hours=i), 90, elevation) for i in range(4)]


def test_evaluate_and_validation():
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
        payload["site"]["latitude_deg"] = -91
        assert client.post("/api/v1/scenarios/evaluate", json=payload).status_code == 422
