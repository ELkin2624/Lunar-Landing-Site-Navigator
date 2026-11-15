"""Transparent free-space downlink budget for a user-specified ground station.

The output is a conditional physical estimate; it does not include DSN booking,
antenna pointing, weather, Doppler, coding implementation, or lunar relays.
"""

import math

from pydantic import BaseModel, Field

C_M_S = 299_792_458.0
BOLTZMANN_DB = 228.6  # -10 log10(k) in dB, with k in W/K/Hz


class LinkBudgetRequest(BaseModel):
    frequency_ghz: float = Field(8.4, gt=0, le=40)
    range_km: float = Field(384_400, ge=350_000, le=410_000)
    spacecraft_eirp_dbw: float = Field(..., ge=-50, le=100)
    ground_station_gt_dbk: float = Field(..., ge=-30, le=100)
    target_rate_mbps: float = Field(..., gt=0, le=250)
    other_losses_db: float = Field(3, ge=0, le=50)
    required_ebn0_db: float = Field(4, ge=-5, le=30)
    implementation_loss_db: float = Field(2, ge=0, le=20)


class LinkBudgetResult(BaseModel):
    free_space_loss_db: float
    cn0_dbhz: float
    ebn0_db: float
    margin_db: float
    max_rate_mbps_at_required_margin: float
    target_rate_supported: bool
    status: str = "conditional_only"
    note: str = "Presupuesto en espacio libre con entradas del usuario; no confirma estación disponible, apuntado, clima ni enlace operativo."


def calculate_link_budget(config: LinkBudgetRequest) -> LinkBudgetResult:
    distance_m = config.range_km * 1000
    frequency_hz = config.frequency_ghz * 1e9
    fspl = 20 * math.log10(4 * math.pi * distance_m * frequency_hz / C_M_S)
    cn0 = config.spacecraft_eirp_dbw - fspl - config.other_losses_db + config.ground_station_gt_dbk + BOLTZMANN_DB
    ebn0 = cn0 - 10 * math.log10(config.target_rate_mbps * 1e6) - config.implementation_loss_db
    margin = ebn0 - config.required_ebn0_db
    max_rate = 10 ** ((cn0 - config.implementation_loss_db - config.required_ebn0_db) / 10) / 1e6
    return LinkBudgetResult(free_space_loss_db=round(fspl, 3), cn0_dbhz=round(cn0, 3),
                            ebn0_db=round(ebn0, 3), margin_db=round(margin, 3),
                            max_rate_mbps_at_required_margin=round(max_rate, 4),
                            target_rate_supported=margin >= 0)
