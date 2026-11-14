from datetime import datetime, timedelta
import math
from pydantic import BaseModel, Field

from .models import Scenario, ScenarioResult, Site


MOON_RADIUS_METERS = 1_737_400.0


def shift_lunar_coordinates(lat_deg: float, lon_deg: float, azimuth_deg: float, distance_m: float) -> tuple[float, float]:
    """Computes destination coordinates on a spherical Moon (radius 1,737.4 km).

    Uses spherical great-circle forward geodesy.
    """
    if distance_m <= 0:
        return lat_deg, lon_deg

    lat1 = math.radians(lat_deg)
    lon1 = math.radians(lon_deg)
    brng = math.radians(azimuth_deg)
    angular_dist = distance_m / MOON_RADIUS_METERS

    lat2 = math.asin(
        math.sin(lat1) * math.cos(angular_dist)
        + math.cos(lat1) * math.sin(angular_dist) * math.cos(brng)
    )
    lon2 = lon1 + math.atan2(
        math.sin(brng) * math.sin(angular_dist) * math.cos(lat1),
        math.cos(angular_dist) - math.sin(lat1) * math.sin(lat2),
    )

    dest_lat = math.degrees(lat2)
    dest_lon = (math.degrees(lon2) + 180.0) % 360.0 - 180.0
    return round(dest_lat, 6), round(dest_lon, 6)


class MissionDeltaRequest(BaseModel):
    baseline_scenario: Scenario
    delay_days: float = Field(default=0.0, ge=0.0, le=90.0, description="Launch/landing delay in days")
    delay_hours: float = Field(default=0.0, ge=0.0, le=24.0, description="Additional delay in hours")
    displacement_meters: float = Field(default=0.0, ge=0.0, le=10000.0, description="Landing site shift in meters")
    displacement_azimuth_deg: float = Field(default=0.0, ge=0.0, lt=360.0, description="Direction of site shift in degrees (0=North, 90=East)")


class DeltaMetrics(BaseModel):
    delta_sunlit_percent: float
    delta_earth_visible_percent: float
    delta_concurrent_percent: float
    delta_longest_darkness_hours: float
    delta_longest_blackout_hours: float
    constraints_status_changed: bool
    baseline_met_constraints: bool
    rescheduled_met_constraints: bool


class MissionDeltaResult(BaseModel):
    rescheduled_site: Site
    rescheduled_start_utc: datetime
    rescheduled_end_utc: datetime
    delay_total_hours: float
    displacement_meters: float
    displacement_azimuth_deg: float
    metrics: DeltaMetrics
    risk_level: str  # "LOW", "MODERATE", "CRITICAL"
    executive_summary: str
    impacts: list[str]
    recommendations: list[str]
    baseline: ScenarioResult
    rescheduled: ScenarioResult


def compute_mission_delta(
    baseline_result: ScenarioResult,
    rescheduled_result: ScenarioResult,
    delay_total_hours: float,
    displacement_meters: float,
    displacement_azimuth_deg: float,
) -> MissionDeltaResult:
    m_base = baseline_result.metrics
    m_resched = rescheduled_result.metrics

    base_sun_pct = round(m_base.sunlit_fraction * 100.0, 1)
    resched_sun_pct = round(m_resched.sunlit_fraction * 100.0, 1)
    delta_sun_pct = round(resched_sun_pct - base_sun_pct, 1)

    base_earth_pct = round(m_base.earth_visible_fraction * 100.0, 1)
    resched_earth_pct = round(m_resched.earth_visible_fraction * 100.0, 1)
    delta_earth_pct = round(resched_earth_pct - base_earth_pct, 1)

    base_conc_pct = round(m_base.concurrent_fraction * 100.0, 1)
    resched_conc_pct = round(m_resched.concurrent_fraction * 100.0, 1)
    delta_conc_pct = round(resched_conc_pct - base_conc_pct, 1)

    delta_darkness = round(m_resched.longest_darkness_hours - m_base.longest_darkness_hours, 1)
    delta_blackout = round(m_resched.longest_earth_blackout_hours - m_base.longest_earth_blackout_hours, 1)

    constraints_changed = m_base.constraints_met != m_resched.constraints_met

    # Determine risk level
    impacts: list[str] = []
    recommendations: list[str] = []

    if delta_sun_pct < -15.0 or delta_darkness > 12.0:
        risk = "CRITICAL"
        impacts.append(f"Pérdida severa de iluminación solar ({delta_sun_pct}%) y aumento crítico de oscuridad continua (+{delta_darkness}h).")
        recommendations.append("Aumentar la capacidad de reserva de baterías o evaluar un sitio alternativo en el catálogo (ej. Malapert Massif).")
    elif delta_sun_pct < -5.0 or delta_darkness > 4.0 or delta_blackout > 6.0:
        risk = "MODERATE"
        impacts.append(f"Reducción moderada de recursos operativos (Sol: {delta_sun_pct}%, Oscuridad: +{delta_darkness}h, Apagón Tierra: +{delta_blackout}h).")
        recommendations.append("Ajustar el cronograma de actividades extravehiculares (EVA) para coincidir con la nueva ventana de simultaneidad.")
    else:
        risk = "LOW"
        impacts.append("Las condiciones operativas se mantienen estables frente a la variación programada.")
        recommendations.append("El plan de misión original sigue siendo viable bajo la nueva fecha/ubicación.")

    if not m_resched.constraints_met:
        impacts.append("El escenario reprogramado VIOLA una o más restricciones de misión configuradas.")

    summary = (
        f"Mission Delta: ante una reprogramación de {delay_total_hours}h y desplazamiento de {displacement_meters}m, "
        f"la disponibilidad solar varía {delta_sun_pct:+}%, la visibilidad terrestre {delta_earth_pct:+}% "
        f"y la noche más larga varía {delta_darkness:+}h. Nivel de riesgo operacional: {risk}."
    )

    metrics = DeltaMetrics(
        delta_sunlit_percent=delta_sun_pct,
        delta_earth_visible_percent=delta_earth_pct,
        delta_concurrent_percent=delta_conc_pct,
        delta_longest_darkness_hours=delta_darkness,
        delta_longest_blackout_hours=delta_blackout,
        constraints_status_changed=constraints_changed,
        baseline_met_constraints=m_base.constraints_met,
        rescheduled_met_constraints=m_resched.constraints_met,
    )

    return MissionDeltaResult(
        rescheduled_site=rescheduled_result.scenario.site,
        rescheduled_start_utc=rescheduled_result.scenario.start_utc,
        rescheduled_end_utc=rescheduled_result.scenario.end_utc,
        delay_total_hours=round(delay_total_hours, 2),
        displacement_meters=displacement_meters,
        displacement_azimuth_deg=displacement_azimuth_deg,
        metrics=metrics,
        risk_level=risk,
        executive_summary=summary,
        impacts=impacts,
        recommendations=recommendations,
        baseline=baseline_result,
        rescheduled=rescheduled_result,
    )
