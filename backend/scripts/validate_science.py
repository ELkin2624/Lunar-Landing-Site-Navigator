"""Reproducible live checks against JPL Horizons and the local LOLA DEM."""

import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path

import httpx

from app.horizons import HorizonsClient
from app.main import evaluate
from app.models import Scenario, Site
from app.terrain import LolaDem


def check_invariants(result) -> None:
    timeline = result.timeline
    assert timeline.segments[0].start_utc == result.scenario.start_utc
    assert timeline.segments[-1].end_utc == result.scenario.end_utc
    assert all(a.end_utc == b.start_utc for a, b in zip(timeline.segments, timeline.segments[1:]))
    duration = (result.scenario.end_utc - result.scenario.start_utc).total_seconds() / 3600
    assert abs(sum(segment.duration_hours for segment in timeline.segments) - duration) < 1e-8
    assert abs(sum(window.duration_hours for window in result.metrics.sunlit_windows) / duration
               - result.metrics.sunlit_fraction) < 1e-8
    assert abs(sum(window.duration_hours for window in result.metrics.earth_visible_windows) / duration
               - result.metrics.earth_visible_fraction) < 1e-8
    assert all(0 <= value <= 1 for value in (
        result.metrics.sunlit_fraction, result.metrics.earth_visible_fraction,
        result.metrics.concurrent_fraction))


async def main() -> None:
    start = datetime(2026, 11, 16, tzinfo=timezone.utc)
    site = Site(latitude_deg=0, longitude_deg=0, label="Temporal reference")
    async with httpx.AsyncClient(timeout=60) as client:
        horizons = HorizonsClient(client)
        results = {}
        for step in (60, 15, 5):
            scenario = Scenario(site=site, start_utc=start, end_utc=start + timedelta(days=2),
                                step_minutes=60, refine_transitions=step < 60,
                                refinement_step_minutes=step if step < 60 else 5)
            result = await evaluate(scenario, horizons)
            check_invariants(result)
            results[str(step)] = {
                "samples": len(result.samples),
                "events": len(result.timeline.events),
                "sunlit_fraction": result.metrics.sunlit_fraction,
                "earth_visible_fraction": result.metrics.earth_visible_fraction,
                "longest_darkness_hours": result.metrics.longest_darkness_hours,
            }
        dem_path = Path(__file__).resolve().parents[1] / "data" / "ldem_75s_240m.img"
        with LolaDem(dem_path) as dem:
            polar = Scenario(site=Site(latitude_deg=-89.5, longitude_deg=0), start_utc=start,
                             end_utc=start + timedelta(hours=6), use_dem_horizon=True)
            polar_result = await evaluate(polar, horizons, dem)
            check_invariants(polar_result)
        report = {
            "source": "JPL Horizons + NASA PDS LOLA LDEM_75S_240M",
            "period_start_utc": start.isoformat(),
            "temporal_resolution_minutes": results,
            "sun_fraction_difference_60_vs_5": abs(results["60"]["sunlit_fraction"] - results["5"]["sunlit_fraction"]),
            "polar_dem": {
                "horizon_source": polar_result.horizon_source,
                "site_height_km_used": polar_result.site_height_km_used,
                "samples": len(polar_result.samples),
            },
            "limits": "Internal consistency and sensitivity checks; no independent orbital or high-resolution terrain reference is used.",
        }
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
