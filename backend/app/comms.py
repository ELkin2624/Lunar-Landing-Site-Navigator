from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field

from .models import Scenario, ScenarioResult


class CommsConfig(BaseModel):
    band: Literal["S", "X", "Ka"] = Field(default="X", description="Banda RF DSN (S, X o Ka)")
    peak_downlink_mbps: float = Field(default=10.0, ge=0.25, le=250.0, description="Tasa pico nominal de bajada hacia Tierra (Mbps)")
    min_grazing_deg: float = Field(default=2.0, ge=0.0, le=15.0, description="Margen angular mínimo sobre el relieve local para enlace nominal (°)")
    daily_data_generation_gb: float = Field(default=12.0, ge=0.1, le=500.0, description="Volumen diario de ciencia y telemetría generado a bordo (GB/día)")
    buffer_capacity_gb: float = Field(default=32.0, ge=1.0, le=2000.0, description="Capacidad de grabadora de estado sólido a bordo (GB)")
    initial_buffer_gb: float = Field(default=0.0, ge=0.0, le=2000.0, description="Datos pendientes al inicio de la ventana (GB)")


class CommsStep(BaseModel):
    time_utc: datetime
    earth_visible: bool
    earth_disk_fraction: float
    clearance_deg: float
    link_state: Literal["nominal", "degraded", "occulted"]
    effective_rate_mbps: float
    downlinked_gb: float
    generated_gb: float
    buffer_gb: float
    buffer_fill_percent: float
    dropped_gb: float


class CommsSimulationResult(BaseModel):
    config: CommsConfig
    comms_viable: bool
    nominal_link_percent: float
    total_generated_gb: float
    total_downlinked_gb: float
    total_dropped_gb: float
    peak_buffer_gb: float
    peak_buffer_percent: float
    final_buffer_gb: float
    average_effective_mbps: float
    summary: str
    operational_link_verified: bool = False
    assumption_note: str = "Tasa pico solo si el centro de la Tierra supera el despeje elegido; sin ubicación ni agenda de estación, presupuesto RF o enlace confirmado. La fracción del disco terrestre no multiplica los Mbps."
    steps: list[CommsStep]


class CommsSimulationRequest(BaseModel):
    scenario: Scenario
    config: CommsConfig = Field(default_factory=CommsConfig)


def simulate_comms(result: ScenarioResult, config: CommsConfig) -> CommsSimulationResult:
    samples = result.samples
    if not samples:
        raise ValueError("No samples available to simulate communications profile")

    dt_hours = result.scenario.step_minutes / 60.0
    gen_per_step_gb = (config.daily_data_generation_gb / 24.0) * dt_hours

    buffer_gb = min(config.buffer_capacity_gb, max(0.0, config.initial_buffer_gb))
    peak_buffer_gb = buffer_gb
    total_gen_gb = 0.0
    total_down_gb = 0.0
    total_dropped_gb = 0.0
    nominal_steps = 0
    rate_sum_mbps = 0.0
    steps: list[CommsStep] = []

    for s in samples:
        clearance_deg = s.earth.elevation_deg - s.earth.horizon_deg
        disk_frac = getattr(s.earth, "disk_fraction", 1.0 if s.earth.visible else 0.0)

        if s.earth.visible and clearance_deg > 0.0:
            if clearance_deg >= config.min_grazing_deg:
                link_state: Literal["nominal", "degraded", "occulted"] = "nominal"
                nominal_steps += 1
                eff_mbps = config.peak_downlink_mbps
            else:
                link_state = "degraded"
                eff_mbps = 0.0
        else:
            eff_mbps = 0.0
            link_state = "occulted"

        cap_gb = (eff_mbps * 3600.0 * dt_hours) / 8000.0
        available_gb = buffer_gb + gen_per_step_gb
        downlinked_gb = min(available_gb, cap_gb)
        unclamped_buffer = available_gb - downlinked_gb
        dropped_gb = max(0.0, unclamped_buffer - config.buffer_capacity_gb)
        buffer_gb = min(config.buffer_capacity_gb, unclamped_buffer)

        peak_buffer_gb = max(peak_buffer_gb, buffer_gb)
        total_gen_gb += gen_per_step_gb
        total_down_gb += downlinked_gb
        total_dropped_gb += dropped_gb
        rate_sum_mbps += eff_mbps

        fill_pct = (buffer_gb / config.buffer_capacity_gb) * 100.0
        steps.append(
            CommsStep(
                time_utc=s.time_utc,
                earth_visible=s.earth.visible,
                earth_disk_fraction=round(disk_frac, 3),
                clearance_deg=round(clearance_deg, 3),
                link_state=link_state,
                effective_rate_mbps=round(eff_mbps, 2),
                downlinked_gb=round(downlinked_gb, 3),
                generated_gb=round(gen_per_step_gb, 3),
                buffer_gb=round(buffer_gb, 3),
                buffer_fill_percent=round(fill_pct, 1),
                dropped_gb=round(dropped_gb, 3),
            )
        )

    peak_pct = round((peak_buffer_gb / config.buffer_capacity_gb) * 100.0, 1)
    nominal_pct = round((nominal_steps / len(samples)) * 100.0, 1)
    avg_mbps = round(rate_sum_mbps / len(samples), 2)
    final_gb = steps[-1].buffer_gb
    comms_viable = total_dropped_gb == 0.0 and peak_pct < 90.0

    if total_dropped_gb > 0.0:
        summary = (
            f"Desbordamiento de grabadora en Banda {config.band}: se perdieron {total_dropped_gb:.2f} GB "
            f"durante apagones terrestres. Aumenta capacidad SSR o tasa de bajada."
        )
    elif peak_pct >= 80.0:
        summary = (
            f"Enlace en margen ajustado (Banda {config.band}): pico de cola {peak_buffer_gb:.1f} GB "
            f"({peak_pct}% de {config.buffer_capacity_gb:.0f} GB); conviene relé lunar de respaldo."
        )
    else:
        summary = (
            f"La cola simulada no se desborda con tasa supuesta en Banda {config.band}: "
            f"bajada potencial {total_down_gb:.1f} GB (media {avg_mbps} Mbps, pico SSR {peak_pct}%). "
            "No se comprobó presupuesto de enlace ni agenda de estación terrestre."
        )

    return CommsSimulationResult(
        config=config,
        comms_viable=comms_viable,
        nominal_link_percent=nominal_pct,
        total_generated_gb=round(total_gen_gb, 2),
        total_downlinked_gb=round(total_down_gb, 2),
        total_dropped_gb=round(total_dropped_gb, 2),
        peak_buffer_gb=round(peak_buffer_gb, 2),
        peak_buffer_percent=peak_pct,
        final_buffer_gb=round(final_gb, 2),
        average_effective_mbps=avg_mbps,
        summary=summary,
        steps=steps,
    )
