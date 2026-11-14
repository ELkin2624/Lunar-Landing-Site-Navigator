from datetime import datetime

from .models import BodyPosition, HorizonPoint, Metrics, Sample, Scenario, Window


def horizon_at(profile: list[HorizonPoint] | None, azimuth: float) -> float:
    if profile is None:
        return 0.0
    points = [(p.azimuth_deg, p.elevation_deg) for p in profile]
    points = [(points[-1][0] - 360, points[-1][1]), *points, (points[0][0] + 360, points[0][1])]
    for (a0, h0), (a1, h1) in zip(points, points[1:]):
        if a0 <= azimuth <= a1:
            return h0 + (h1 - h0) * (azimuth - a0) / (a1 - a0)
    raise ValueError("Invalid azimuth")


def position(azimuth: float, elevation: float, profile: list[HorizonPoint] | None, clearance: float = 0) -> BodyPosition:
    horizon = horizon_at(profile, azimuth)
    return BodyPosition(azimuth_deg=azimuth, elevation_deg=elevation, horizon_deg=horizon, visible=elevation > horizon + clearance)


def _windows(samples: list[Sample], end: datetime, body: str) -> tuple[list[Window], float, float]:
    windows = []
    visible_start = None
    dark_start = None
    longest_dark = 0.0
    visible_total = 0.0
    for sample in [*samples, Sample(time_utc=end, sun=samples[-1].sun, earth=samples[-1].earth)]:
        t = sample.time_utc
        is_visible = getattr(sample, body).visible if t != end else False
        if is_visible:
            if visible_start is None:
                visible_start = t
            if dark_start is not None:
                longest_dark = max(longest_dark, (t - dark_start).total_seconds() / 3600)
                dark_start = None
        else:
            if visible_start is not None:
                hours = (t - visible_start).total_seconds() / 3600
                windows.append(Window(start_utc=visible_start, end_utc=t, duration_hours=hours))
                visible_total += hours
                visible_start = None
            if dark_start is None:
                dark_start = t
    if dark_start is not None:
        longest_dark = max(longest_dark, (end - dark_start).total_seconds() / 3600)
    return windows, visible_total, longest_dark


def analyze(scenario: Scenario, samples: list[Sample]) -> Metrics:
    duration_hours = (scenario.end_utc - scenario.start_utc).total_seconds() / 3600
    sun_windows, sun_hours, darkness = _windows(samples, scenario.end_utc, "sun")
    earth_windows, earth_hours, blackout = _windows(samples, scenario.end_utc, "earth")
    concurrent_hours = 0.0
    for current, following in zip(samples, [*samples[1:], None]):
        until = following.time_utc if following is not None else scenario.end_utc
        if current.sun.visible and current.earth.visible:
            concurrent_hours += (until - current.time_utc).total_seconds() / 3600
    constraints = scenario.constraints
    sun_fraction = sun_hours / duration_hours
    earth_fraction = earth_hours / duration_hours
    met = sun_fraction >= constraints.min_sunlit_fraction and earth_fraction >= constraints.min_earth_visible_fraction
    if constraints.max_darkness_hours is not None:
        met &= darkness <= constraints.max_darkness_hours
    if constraints.max_earth_blackout_hours is not None:
        met &= blackout <= constraints.max_earth_blackout_hours
    return Metrics(sunlit_fraction=sun_fraction, earth_visible_fraction=earth_fraction,
                   concurrent_fraction=concurrent_hours / duration_hours,
                   longest_darkness_hours=darkness, longest_earth_blackout_hours=blackout,
                   sunlit_windows=sun_windows, earth_visible_windows=earth_windows, constraints_met=met)
