from datetime import timedelta

from fastapi.testclient import TestClient

from app.main import app
from tests.test_api import synthetic_dem


class DailyPatternHorizons:
    """Day 1 fully lit, day 2 dark, day 3 lit half the day, day 4 lit for 4 hours; dark afterwards."""

    async def positions(self, body_id, site, start, end, step_minutes):
        rows = []
        time = start
        while time <= end:
            day, hour = (time - start).days, time.hour
            lit = day == 0 or (day == 2 and hour < 12) or (day == 3 and hour < 4)
            rows.append((time, 15.0 * hour, 3.0 if lit else -3.0))
            time += timedelta(minutes=step_minutes)
        return rows


def test_illumination_calendar_classifies_days(monkeypatch, tmp_path):
    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(synthetic_dem(tmp_path)))
    with TestClient(app) as client:
        app.state.horizons = DailyPatternHorizons()
        response = client.post("/api/v1/illumination/calendar", json={"latitude": -89.5, "longitude": 0, "year": 2027, "month": 2})
        assert response.status_code == 200, response.text
        data = response.json()
        assert len(data["days"]) == 28
        first, second, third, fourth = data["days"][:4]
        assert first["date"] == "2027-02-01" and first["sunlit_percent"] == 100 and first["level"] == "favorable"
        assert second["sunlit_percent"] == 0 and second["level"] == "none"
        assert third["sunlit_percent"] == 50 and third["level"] == "partial"
        assert fourth["level"] == "minimal"
        assert first["sun_elevation_deg"] == 3.0 and first["max_clearance_deg"] > 0
        assert client.post("/api/v1/illumination/calendar", json={"latitude": -60, "longitude": 0, "year": 2027, "month": 2}).status_code == 422


def test_illumination_calendar_requires_dem(monkeypatch, tmp_path):
    monkeypatch.setenv("LUNARPATH_DEM_PATH", str(tmp_path / "missing.img"))
    with TestClient(app) as client:
        response = client.post("/api/v1/illumination/calendar", json={"latitude": -89.5, "longitude": 0, "year": 2027, "month": 2})
        assert response.status_code == 503
