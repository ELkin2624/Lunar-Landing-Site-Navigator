from datetime import datetime
import math
from pydantic import BaseModel, Field

from .models import Sample, Scenario, ScenarioResult

LUNAR_SOLAR_CONSTANT_W_M2 = 1361.0


class PowerConfig(BaseModel):
    solar_panel_area_m2: float = Field(default=2.5, ge=0.1, le=50.0, description="Effective solar array area in m²")
    panel_efficiency: float = Field(default=0.30, ge=0.05, le=0.50, description="Solar cell efficiency (default 30% for triple-junction space cells)")
    base_load_watts: float = Field(default=120.0, ge=1.0, le=5000.0, description="Continuous operational/survival power draw in Watts")
    battery_capacity_wh: float = Field(default=2500.0, ge=50.0, le=100000.0, description="Total usable battery energy capacity in Watt-hours")
    initial_soc_percent: float = Field(default=100.0, ge=0.0, le=100.0, description="Initial State of Charge (%)")
    min_allowable_soc_percent: float = Field(default=20.0, ge=0.0, le=50.0, description="Critical discharge reserve threshold (%)")
    solar_derate_factor: float = Field(default=0.8, ge=0.1, le=1.0, description="Combined dust, temperature, wiring and pointing derate")
    shadow_heater_watts: float = Field(default=0.0, ge=0, le=5000, description="Additional heater load when the Sun is blocked")
    battery_charge_efficiency: float = Field(default=0.9, ge=0.5, le=1.0)
    battery_discharge_efficiency: float = Field(default=0.9, ge=0.5, le=1.0)


class PowerStep(BaseModel):
    time_utc: datetime
    sun_visible: bool
    sun_disk_fraction: float
    power_generated_w: float
    net_power_w: float
    battery_energy_wh: float
    soc_percent: float


class PowerSimulationResult(BaseModel):
    config: PowerConfig
    survives_mission: bool
    min_soc_percent: float
    final_soc_percent: float
    total_energy_generated_kwh: float
    total_energy_consumed_kwh: float
    critical_threshold_breached: bool
    blackout_hours_supported: float
    summary: str
    vehicle_system_verified: bool = False
    assumption_note: str = "Perfil eléctrico condicional; requiere cargas, orientación, datos térmicos y ensayos del vehículo real."
    steps: list[PowerStep]


class PowerSimulationRequest(BaseModel):
    scenario: Scenario
    config: PowerConfig = Field(default_factory=PowerConfig)



def simulate_power(result: ScenarioResult, config: PowerConfig) -> PowerSimulationResult:
    samples = result.samples
    if not samples:
        raise ValueError("No samples available to simulate power profile")

    # Time step delta
    step_minutes = result.scenario.step_minutes
    dt_hours = step_minutes / 60.0

    current_wh = config.battery_capacity_wh * (config.initial_soc_percent / 100.0)
    min_wh = current_wh
    total_gen_wh = 0.0
    total_load_wh = 0.0
    breached = False
    survives = True

    steps: list[PowerStep] = []

    for s in samples:
        # Solar elevation angle
        el_deg = s.sun.elevation_deg
        disk_frac = getattr(s.sun, "disk_fraction", 1.0 if s.sun.visible else 0.0)
        
        # Vertical solar panel oriented azimuthally towards Sun (common design for lunar south pole)
        # Power is proportional to cosine of elevation (since sun is at horizontal incidence)
        if disk_frac > 0:
            cos_factor = max(0.0, math.cos(math.radians(max(0.0, el_deg))))
            power_gen = (
                LUNAR_SOLAR_CONSTANT_W_M2
                * config.solar_panel_area_m2
                * config.panel_efficiency
                * cos_factor
                * disk_frac
                * config.solar_derate_factor
            )
        else:
            power_gen = 0.0

        load_w = config.base_load_watts + (config.shadow_heater_watts if disk_frac <= 0 else 0.0)
        net_w = power_gen - load_w
        delta_wh = net_w * dt_hours * (config.battery_charge_efficiency if net_w >= 0 else 1 / config.battery_discharge_efficiency)

        # Update battery
        new_wh = min(config.battery_capacity_wh, max(0.0, current_wh + delta_wh))
        current_wh = new_wh
        min_wh = min(min_wh, current_wh)

        total_gen_wh += power_gen * dt_hours
        total_load_wh += load_w * dt_hours

        soc = (current_wh / config.battery_capacity_wh) * 100.0
        if soc < config.min_allowable_soc_percent:
            breached = True
        if current_wh <= 0.0:
            survives = False

        steps.append(
            PowerStep(
                time_utc=s.time_utc,
                sun_visible=s.sun.visible,
                sun_disk_fraction=round(disk_frac, 3),
                power_generated_w=round(power_gen, 2),
                net_power_w=round(net_w, 2),
                battery_energy_wh=round(current_wh, 2),
                soc_percent=round(soc, 2),
            )
        )

    min_soc = round((min_wh / config.battery_capacity_wh) * 100.0, 2)
    final_soc = steps[-1].soc_percent if steps else 0.0

    if survives and not breached:
        summary = f"El perfil energético estimado conserva {min_soc}% de carga mínima con estos supuestos; falta validar panel, temperatura y cargas del vehículo."
    elif survives and breached:
        summary = f"La carga estimada cae a {min_soc}%, bajo la reserva configurada ({config.min_allowable_soc_percent}%)."
    else:
        summary = f"Fallo por agotamiento energético: la batería se descargó por completo durante la noche/sombra lunar."

    return PowerSimulationResult(
        config=config,
        survives_mission=survives,
        min_soc_percent=min_soc,
        final_soc_percent=final_soc,
        total_energy_generated_kwh=round(total_gen_wh / 1000.0, 3),
        total_energy_consumed_kwh=round(total_load_wh / 1000.0, 3),
        critical_threshold_breached=breached,
        blackout_hours_supported=round(config.battery_capacity_wh * (1 - config.min_allowable_soc_percent / 100) * config.battery_discharge_efficiency / max(1, config.base_load_watts + config.shadow_heater_watts), 1),
        summary=summary,
        steps=steps,
    )
