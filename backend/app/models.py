from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field, field_validator, model_validator


class Site(BaseModel):
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=180)
    height_km: float = Field(default=0, ge=-10, le=20, description="Height above the Horizons lunar reference ellipsoid, in km")
    label: str | None = Field(default=None, max_length=100)


class HorizonPoint(BaseModel):
    azimuth_deg: float = Field(ge=0, lt=360)
    elevation_deg: float = Field(ge=-90, le=90)


class Constraints(BaseModel):
    min_sunlit_fraction: float = Field(default=0, ge=0, le=1)
    min_earth_visible_fraction: float = Field(default=0, ge=0, le=1)
    max_darkness_hours: float | None = Field(default=None, ge=0)
    max_earth_blackout_hours: float | None = Field(default=None, ge=0)
    min_earth_elevation_deg: float = Field(default=0, ge=0, le=90)


class Scenario(BaseModel):
    site: Site
    start_utc: datetime
    end_utc: datetime
    step_minutes: int = Field(default=60, ge=15, le=1440)
    horizon_profile: list[HorizonPoint] | None = None
    constraints: Constraints = Field(default_factory=Constraints)

    @field_validator("start_utc", "end_utc")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Date and time must include a UTC offset")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validate_range(self) -> "Scenario":
        duration = self.end_utc - self.start_utc
        if duration <= timedelta(0) or duration > timedelta(days=14):
            raise ValueError("Time range must be greater than zero and at most 14 days")
        if duration.total_seconds() / (self.step_minutes * 60) > 500:
            raise ValueError("Time range exceeds 500 steps")
        if self.horizon_profile is not None:
            if not 2 <= len(self.horizon_profile) <= 360:
                raise ValueError("Horizon profile needs 2 to 360 points")
            azimuths = [p.azimuth_deg for p in self.horizon_profile]
            if azimuths != sorted(set(azimuths)):
                raise ValueError("Horizon azimuths must be sorted and unique")
        return self


class CompareRequest(BaseModel):
    scenarios: list[Scenario] = Field(min_length=2, max_length=5)


class BodyPosition(BaseModel):
    azimuth_deg: float
    elevation_deg: float
    horizon_deg: float
    visible: bool


class Sample(BaseModel):
    time_utc: datetime
    sun: BodyPosition
    earth: BodyPosition


class Window(BaseModel):
    start_utc: datetime
    end_utc: datetime
    duration_hours: float


class Metrics(BaseModel):
    sunlit_fraction: float
    earth_visible_fraction: float
    concurrent_fraction: float
    longest_darkness_hours: float
    longest_earth_blackout_hours: float
    sunlit_windows: list[Window]
    earth_visible_windows: list[Window]
    constraints_met: bool


class ScenarioResult(BaseModel):
    scenario: Scenario
    samples: list[Sample]
    metrics: Metrics
    ephemeris_source: str = "JPL Horizons"
    horizon_source: str
    precision_note: str = "Windows are estimated on the requested sample grid; short events between samples may be missed. Sun and Earth are treated as point sources."
