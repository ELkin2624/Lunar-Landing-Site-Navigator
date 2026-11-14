import re
from datetime import datetime
from pydantic import BaseModel, Field

from .models import Constraints, ScenarioResult


class CopilotRequest(BaseModel):
    scenario_result: ScenarioResult
    user_query: str | None = Field(default=None, description="Optional natural language question about the scenario")


class CopilotResponse(BaseModel):
    title: str
    verdict: str
    scientific_explanation: str
    illumination_diagnosis: str
    communication_diagnosis: str
    thermal_and_energy_notes: str
    direct_answer: str | None = None
    suggested_actions: list[str]


def parse_natural_constraints(prompt: str) -> Constraints:
    """Extracts mission constraints from natural language prompt."""
    p = prompt.lower()
    constraints = Constraints()

    # Darkness regex
    dark_match = re.search(r"(?:menos de|máximo|max|hasta)\s*(\d+(?:\.\d+)?)\s*(?:horas|h)\s*(?:de\s*)?(?:oscuridad|noche|sombra)", p)
    if dark_match:
        constraints.max_darkness_hours = float(dark_match.group(1))

    # Blackout regex
    blackout_match = re.search(r"(?:menos de|máximo|max|hasta)\s*(\d+(?:\.\d+)?)\s*(?:horas|h)\s*(?:de\s*)?(?:apagón|blackout|desconexión|sin comunicación)", p)
    if blackout_match:
        constraints.max_earth_blackout_hours = float(blackout_match.group(1))

    # Sunlit fraction regex
    sun_match = re.search(r"(?:al menos|mínimo|min)\s*(\d+(?:\.\d+)?)\s*%\s*(?:de\s*)?(?:sol|luz|iluminación)", p)
    if sun_match:
        constraints.min_sunlit_fraction = float(sun_match.group(1)) / 100.0

    # Earth visible fraction regex
    earth_match = re.search(r"(?:al menos|mínimo|min)\s*(\d+(?:\.\d+)?)\s*%\s*(?:de\s*)?(?:tierra|comunicación|visibilidad terrestre)", p)
    if earth_match:
        constraints.min_earth_visible_fraction = float(earth_match.group(1)) / 100.0

    # Min earth elevation
    elev_match = re.search(
        r"(?:(?:elevaci[oó]n|ángulo)\s*m[ií]nim[ao]\s*(?:de\s*la\s*tierra\s*)?(?:de\s*)?(\d+(?:\.\d+)?)\s*(?:grados|°|deg)?)|"
        r"(?:(\d+(?:\.\d+)?)\s*(?:grados|°|deg)\s*de\s*(?:elevaci[oó]n|ángulo))",
        p,
    )
    if elev_match:
        val = elev_match.group(1) or elev_match.group(2)
        if val:
            constraints.min_earth_elevation_deg = float(val)


    return constraints


def diagnose_scenario(result: ScenarioResult, user_query: str | None = None) -> CopilotResponse:
    m = result.metrics
    sc = result.scenario
    site_label = sc.site.label or f"Lat {sc.site.latitude_deg:.2f}°, Lon {sc.site.longitude_deg:.2f}°"
    sun_pct = round(m.sunlit_fraction * 100.0, 1)
    earth_pct = round(m.earth_visible_fraction * 100.0, 1)
    conc_pct = round(m.concurrent_fraction * 100.0, 1)

    # Illumination diagnosis
    if sun_pct >= 75.0:
        illum_diag = (
            f"Excelente persistencia de iluminación solar ({sun_pct}% del tiempo). "
            f"El período continuo de oscuridad más largo es de {m.longest_darkness_hours}h. "
            f"Este sitio aprovecha la topografía elevada para captar luz solar rasante."
        )
    elif sun_pct >= 45.0:
        illum_diag = (
            f"Iluminación moderada ({sun_pct}% del tiempo). La noche máxima alcanza {m.longest_darkness_hours}h. "
            f"Se requieren baterías de tamaño medio o gestión activa de hibernación nocturna."
        )
    else:
        illum_diag = (
            f"Baja iluminación ({sun_pct}% del tiempo). La oscuridad acumulada es prolongada ({m.longest_darkness_hours}h consecutivas). "
            f"El sitio puede estar situado en una depresión topográfica o recibir sombra de bordes de cráteres adyacentes."
        )

    # Communication diagnosis
    if earth_pct >= 80.0:
        comm_diag = (
            f"Línea de visión a la Tierra continua y robusta ({earth_pct}% del período analizado), "
            f"con un apagón máximo de tan solo {m.longest_earth_blackout_hours}h. Soporta comunicación directa DSN sin satélites de retransmisión."
        )
    elif earth_pct >= 50.0:
        comm_diag = (
            f"Visibilidad terrestre intermedia ({earth_pct}%). Se registran intervalos de pérdida de contacto de hasta {m.longest_earth_blackout_hours}h "
            f"debido a la libración lunar y obstáculos en el horizonte local."
        )
    else:
        comm_diag = (
            f"Cobertura de comunicaciones deficiente ({earth_pct}%). El apagón continuo alcanza {m.longest_earth_blackout_hours}h. "
            f"Es crítico contar con un satélite de retransmisión en órbita lunar para garantizar la seguridad de la misión."
        )

    # Thermal and energy
    thermal_notes = (
        f"En el polo sur lunar, el Sol se desplaza horizontalmente cerca del horizonte local. "
        f"Se recomienda emplear paneles solares verticales o con seguimiento azimutal para maximizar la irradiancia incidente. "
        f"Durante las {m.longest_darkness_hours}h de sombra, el sistema requerirá calefacción por radioisótopos (RHU) o baterías de supervivencia térmica."
    )

    # Verdict
    if m.constraints_met:
        verdict = "APTO / CUMPLE RESTRICCIONES DE MISIÓN"
        title = f"Diagnóstico Científico: {site_label} — Escenario Conforme"
    else:
        verdict = "NO CONFORME / RESTRICCIONES VIOLADAS"
        title = f"Diagnóstico Científico: {site_label} — Requiere Mitigación"

    # Suggested actions
    actions: list[str] = []
    if not m.constraints_met:
        actions.append("Revisar si la duración de la batería soporta la noche máxima observada.")
        actions.append("Evaluar adelantar o retrasar la fecha de aterrizaje usando la herramienta Mission Delta.")
        actions.append("Comparar contra sitios de mayor cota topográfica como Mons Mouton o Malapert Massif.")
    else:
        actions.append(f"Aprovechar la ventana de simultaneidad ({conc_pct}% del tiempo) para operaciones científicas de alta transmisión de datos.")
        actions.append("Exportar la serie temporal CSV para validación detallada en herramientas de navegación de misión.")

    # Direct answer to user query if present
    direct_answer = None
    if user_query:
        q = user_query.lower()
        if "batería" in q or "bateria" in q or "energía" in q or "energia" in q:
            direct_answer = (
                f"Para este escenario en '{site_label}', la batería debe ser capaz de alimentar la carga vital durante al menos "
                f"{m.longest_darkness_hours} horas consecutivas de oscuridad. La generación solar total cubre el {sun_pct}% del tiempo."
            )
        elif "comunicación" in q or "comunicacion" in q or "tierra" in q or "blackout" in q:
            direct_answer = (
                f"La comunicación directa con la Tierra está garantizada el {earth_pct}% del tiempo. "
                f"El período más largo sin línea de visión es de {m.longest_earth_blackout_hours} horas. "
                f"Fuente de datos de horizonte: {result.horizon_source}."
            )
        elif "por qué" in q or "porque" in q or "razón" in q or "razon" in q:
            direct_answer = (
                f"Las variaciones observadas provienen de la combinación de la trayectoria orbital calculada por JPL Horizons "
                f"y la elevación del horizonte lunar ({result.horizon_source}). Cuando el astro cae por debajo del relieve local, "
                f"se produce la interrupción de la ventana operativa."
            )
        else:
            direct_answer = (
                f"Respuesta del Copiloto para '{user_query}': En '{site_label}' del {sc.start_utc.strftime('%Y-%m-%d')} al {sc.end_utc.strftime('%Y-%m-%d')}, "
                f"se cuenta con {sun_pct}% de luz solar, {earth_pct}% de visibilidad terrestre y {conc_pct}% de concurrencia. "
                f"Estado de restricciones: {'Cumplidas' if m.constraints_met else 'No cumplidas'}."
            )

    scientific_exp = (
        f"El análisis para {site_label} abarca desde {sc.start_utc.isoformat()} hasta {sc.end_utc.isoformat()} "
        f"con muestreo cada {sc.step_minutes} minutos. Las efemérides astronómicas fueron generadas mediante {result.ephemeris_source} "
        f"y evaluadas contra el perfil de horizonte '{result.horizon_source}'. La altura del sitio utilizada es de {result.site_height_km_used:.3f} km."
    )

    return CopilotResponse(
        title=title,
        verdict=verdict,
        scientific_explanation=scientific_exp,
        illumination_diagnosis=illum_diag,
        communication_diagnosis=comm_diag,
        thermal_and_energy_notes=thermal_notes,
        direct_answer=direct_answer,
        suggested_actions=actions,
    )
