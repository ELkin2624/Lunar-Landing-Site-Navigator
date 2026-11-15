import asyncio
from contextlib import asynccontextmanager
import csv
from datetime import timedelta
import io
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from .analysis import analyze, apply_refined_events, build_timeline, position
from .cache import EphemerisCache
from .catalog import CatalogSite, find_site, list_sites
from .comms import CommsSimulationRequest, CommsSimulationResult, simulate_comms
from .copilot import CopilotRequest, CopilotResponse, diagnose_scenario, parse_natural_constraints
from .delta import MissionDeltaRequest, MissionDeltaResult, compute_mission_delta, shift_lunar_coordinates
from .footprint import FootprintRequest, FootprintResult, assess_footprint
from .horizons import HorizonsClient, HorizonsError
from .link_budget import LinkBudgetRequest, LinkBudgetResult, calculate_link_budget
from .mesh import MeshRequest, MeshResult, terrain_mesh
from .nac_texture import build_texture_with_meta
from .models import (
    CompareRequest,
    Constraints,
    EphemerisPoint,
    EphemerisRequest,
    EphemerisResponse,
    LegacyAnalyzeRequest,
    LegacyAnalyzeResponse,
    LegacySample,
    Sample,
    Scenario,
    ScenarioResult,
    Site,
    TerrainRequest,
    TerrainResult,
)
from .power import PowerSimulationRequest, PowerSimulationResult, simulate_power
from .ranking import RankRequest, RankingResponse, rank_scenarios
from .slope import SlopeRequest, SlopeResult, regional_slope
from .terrain import LolaDem, TerrainError, _destination, dem_error_envelopes, horizon_profile
from .transitions import effective_step_minutes

BACKEND_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_DIR / ".env")


@asynccontextmanager
async def lifespan(app: FastAPI):
    default_dem = BACKEND_DIR / "data" / "ldem_75s_240m.img"
    configured_dem = Path(os.getenv("LUNARPATH_DEM_PATH", str(default_dem)))
    if not configured_dem.is_absolute():
        configured_dem = BACKEND_DIR / configured_dem
    app.state.dem = LolaDem(configured_dem) if configured_dem.exists() else None
    fine_path = BACKEND_DIR / "data" / "ldem_875s_20m.img"
    app.state.fine_dem = LolaDem(fine_path) if configured_dem == default_dem and fine_path.exists() else None

    # Persistent ephemeris cache
    default_cache = BACKEND_DIR / "data" / "horizons_cache.sqlite"
    cache_path = os.getenv("LUNARPATH_CACHE_DB", str(default_cache))
    cache_enabled = os.getenv("LUNARPATH_CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
    app.state.cache = EphemerisCache(cache_path) if cache_enabled else None
    app.state.calendar_profiles = {}

    async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=10)) as client:
        app.state.horizons = HorizonsClient(client, cache=app.state.cache)
        yield
    if app.state.dem is not None:
        app.state.dem.close()
    if app.state.fine_dem is not None:
        app.state.fine_dem.close()


app = FastAPI(
    title="LunarPath AI API",
    description="Scientific API for lunar South Pole illumination, Earth visibility, LOLA DEM horizons, and landing site evaluation.",
    version="0.2.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv("LUNARPATH_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/data/availability", tags=["Status"])
def data_availability(request: Request) -> dict:
    """Report installed scientific assets, without claiming remote service uptime."""
    broad = request.app.state.dem
    fine = request.app.state.fine_dem
    nac_dir = BACKEND_DIR / "data" / "nac_dtm"
    products = sorted(path.stem for path in nac_dir.glob("NAC_DTM_*.TIF") if path.is_file())
    return {
        "analysis_ready": broad is not None,
        "horizons_status": "checked_per_request",
        "dem_240m": broad is not None,
        "dem_20m": fine is not None,
        "nac_stereo_products": products,
        "nac_local_coverage": "limited_to_product_footprints",
        "note": "La disponibilidad de Horizons y Moon Trek se comprueba al solicitar cada análisis o tesela.",
    }


@app.post("/api/v1/comms/link-budget", response_model=LinkBudgetResult, tags=["Communications"])
def link_budget(payload: LinkBudgetRequest) -> LinkBudgetResult:
    return calculate_link_budget(payload)


# ---------------------------------------------------------------------------
# Catalog endpoints (Official Artemis candidate landing regions & polar sites)
# ---------------------------------------------------------------------------


@app.get("/api/v1/catalog/sites", response_model=list[CatalogSite], tags=["Catalog"])
@app.get("/api/v1/sites", response_model=list[CatalogSite], tags=["Catalog"])
def get_catalog_sites(
    artemis_only: bool = Query(default=False, description="Filter only official Artemis candidate regions"),
    query: str | None = Query(default=None, description="Search query by name or region"),
) -> list[CatalogSite]:
    return list_sites(artemis_only=artemis_only, query=query)


@app.get("/api/v1/catalog/sites/{site_id}", response_model=CatalogSite, tags=["Catalog"])
@app.get("/api/v1/sites/{site_id}", response_model=CatalogSite, tags=["Catalog"])
def get_catalog_site(site_id: str) -> CatalogSite:
    site = find_site(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found in lunar catalog")
    return site


# ---------------------------------------------------------------------------
# Terrain Horizon endpoint (LOLA DEM)
# ---------------------------------------------------------------------------


@app.post("/api/v1/terrain/footprint", response_model=FootprintResult, tags=["Terrain"])
async def terrain_footprint(payload: FootprintRequest) -> FootprintResult:
    return await run_in_threadpool(assess_footprint, payload, BACKEND_DIR / "data" / "nac_dtm")


@app.post("/api/v1/terrain/mesh", response_model=MeshResult, tags=["Terrain"])
def get_terrain_mesh(payload: MeshRequest, request: Request) -> MeshResult:
    dem = request.app.state.fine_dem if payload.site.latitude_deg <= -87.55 else None
    try:
        if dem is not None:
            try:
                return terrain_mesh(dem, payload.site)
            except TerrainError:
                pass
        return terrain_mesh(require_dem(request), payload.site)
    except TerrainError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/v1/terrain/nac-texture", tags=["Terrain"])
async def get_nac_texture(
    latitude_deg: float = Query(ge=-90, le=-75),
    longitude_deg: float = Query(ge=-180, le=180),
    span_m: int = Query(default=2000, ge=2000, le=9600),
) -> Response:
    async with httpx.AsyncClient(timeout=20) as client:
        try:
            png, pixel_m, coverage, cache_hits, total_tiles = await build_texture_with_meta(
                client, latitude_deg, longitude_deg, span_m
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
    cache_state = "hit" if total_tiles > 0 and cache_hits == total_tiles else ("partial" if cache_hits > 0 else "miss")
    return Response(content=png, media_type="image/png", headers={
        "X-Texture-Source": "Moon-Trek-LROC-NAC",
        "X-Texture-Pixel-M": f"{pixel_m:.3f}",
        "X-Tile-Coverage-Fraction": f"{coverage:.3f}",
        "X-Texture-Cache": cache_state,
        "Cache-Control": "public, max-age=86400",
    })


def require_dem(request: Request) -> LolaDem:
    dem = request.app.state.dem
    if dem is None:
        raise HTTPException(status_code=503, detail="LOLA DEM is not installed; run scripts/download_lola.py")
    return dem


@app.post("/api/v1/terrain/horizon", response_model=TerrainResult, tags=["Terrain"])
def terrain_horizon(payload: TerrainRequest, request: Request) -> TerrainResult:
    dem = require_dem(request)
    try:
        profile, height = horizon_profile(
            dem,
            payload.site,
            observer_height_m=payload.observer_height_m,
            max_distance_km=payload.max_distance_km,
            azimuth_step_deg=payload.azimuth_step_deg,
            fine_dem=request.app.state.fine_dem,
        )
    except TerrainError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    mixed = any(point.obstacle_pixel_scale_m == 20 for point in profile)
    return TerrainResult(site=payload.site, profile=profile, site_height_km_used=height,
                         source="LOLA_20M_NEAR_240M_FAR" if mixed else "LOLA_LDEM_75S_240M_PDS",
                         pixel_scale_m=20 if mixed else 240)


@app.get("/api/v1/sites/{site_id}/horizon", response_model=TerrainResult, tags=["Terrain"])
def get_site_horizon(
    site_id: str,
    request: Request,
    observer_height_m: float = Query(default=2.0, ge=0.0, le=100.0),
    max_distance_km: float = Query(default=250.0, ge=1.0, le=300.0),
    azimuth_step_deg: int = Query(default=1),
) -> TerrainResult:
    site = find_site(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found in lunar catalog")
    dem = require_dem(request)
    site_model = Site(
        latitude_deg=site.latitude_deg,
        longitude_deg=site.longitude_deg,
        height_km=site.estimated_height_km,
        label=site.name,
    )
    try:
        profile, height = horizon_profile(
            dem,
            site_model,
            observer_height_m=observer_height_m,
            max_distance_km=max_distance_km,
            azimuth_step_deg=azimuth_step_deg,
            fine_dem=request.app.state.fine_dem,
        )
    except TerrainError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    mixed = any(point.obstacle_pixel_scale_m == 20 for point in profile)
    return TerrainResult(site=site_model, profile=profile, site_height_km_used=height,
                         source="LOLA_20M_NEAR_240M_FAR" if mixed else "LOLA_LDEM_75S_240M_PDS",
                         pixel_scale_m=20 if mixed else 240)


@app.post("/api/v1/terrain/slope", response_model=SlopeResult, tags=["Terrain"])
async def terrain_slope(payload: SlopeRequest, request: Request) -> SlopeResult:
    dem = require_dem(request)
    fine_dem: LolaDem | None = request.app.state.fine_dem
    if fine_dem is not None and payload.site.latitude_deg <= -87.5:
        try:
            return await run_in_threadpool(
                regional_slope,
                fine_dem,
                payload.site,
                baseline_pixels=payload.baseline_pixels,
                neighborhood_radius_m=payload.neighborhood_radius_m,
                threshold_deg=payload.threshold_deg,
            )
        except TerrainError:
            pass
    try:
        return await run_in_threadpool(
            regional_slope,
            dem,
            payload.site,
            baseline_pixels=payload.baseline_pixels,
            neighborhood_radius_m=payload.neighborhood_radius_m,
            threshold_deg=payload.threshold_deg,
        )
    except (TerrainError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/api/v1/sites/{site_id}/slope", response_model=SlopeResult, tags=["Terrain"])
async def get_site_slope(
    site_id: str,
    request: Request,
    baseline_pixels: int = Query(default=1),
    neighborhood_radius_m: float = Query(default=1000, ge=0, le=5000),
    threshold_deg: float | None = Query(default=None, gt=0, lt=90),
) -> SlopeResult:
    site = find_site(site_id)
    if site is None:
        raise HTTPException(status_code=404, detail=f"Site '{site_id}' not found in lunar catalog")
    site_model = Site(latitude_deg=site.latitude_deg, longitude_deg=site.longitude_deg, label=site.name)
    return await terrain_slope(SlopeRequest(site=site_model, baseline_pixels=baseline_pixels,
                                            neighborhood_radius_m=neighborhood_radius_m,
                                            threshold_deg=threshold_deg), request)


# ---------------------------------------------------------------------------
# Celestial Ephemeris endpoint (JPL Horizons)
# ---------------------------------------------------------------------------


@app.post("/api/v1/ephemeris", response_model=EphemerisResponse, tags=["Ephemeris"])
async def get_ephemeris(payload: EphemerisRequest, request: Request) -> EphemerisResponse:
    horizons: HorizonsClient = request.app.state.horizons
    sun_pts = None
    earth_pts = None
    try:
        if payload.body_id in (None, 10):
            sun_rows = await horizons.positions(10, payload.site, payload.start_utc, payload.end_utc, payload.step_minutes)
            sun_pts = [EphemerisPoint(time_utc=r[0], azimuth_deg=r[1], elevation_deg=r[2]) for r in sun_rows]
        if payload.body_id in (None, 399):
            earth_rows = await horizons.positions(399, payload.site, payload.start_utc, payload.end_utc, payload.step_minutes)
            earth_pts = [EphemerisPoint(time_utc=r[0], azimuth_deg=r[1], elevation_deg=r[2]) for r in earth_rows]
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return EphemerisResponse(
        site=payload.site,
        start_utc=payload.start_utc,
        end_utc=payload.end_utc,
        step_minutes=payload.step_minutes,
        sun=sun_pts,
        earth=earth_pts,
    )



# ---------------------------------------------------------------------------
# Scenario evaluation core
# ---------------------------------------------------------------------------


async def evaluate(scenario: Scenario, horizons: HorizonsClient, dem: LolaDem | None = None,
                   fine_dem: LolaDem | None = None) -> ScenarioResult:
    try:
        effective_step = effective_step_minutes(scenario)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    profile = scenario.horizon_profile
    site = scenario.site
    source = "user_supplied_profile" if profile is not None else "geometric_0_deg"
    if scenario.use_dem_horizon:
        if dem is None:
            raise HTTPException(status_code=503, detail="LOLA DEM is not installed; run scripts/download_lola.py")
        try:
            profile, height_km = await run_in_threadpool(
                horizon_profile,
                dem,
                site,
                observer_height_m=scenario.observer_height_m,
                max_distance_km=scenario.max_horizon_distance_km,
                fine_dem=fine_dem,
            )
        except TerrainError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        site = site.model_copy(update={"height_km": height_km})
        source = "LOLA_20M_NEAR_240M_FAR" if any(p.obstacle_pixel_scale_m == 20 for p in profile) else "LOLA_LDEM_75S_240M_PDS"
    try:
        sun = await horizons.positions(10, site, scenario.start_utc, scenario.end_utc, effective_step)
        earth = await horizons.positions(399, site, scenario.start_utc, scenario.end_utc, effective_step)
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if [row[0] for row in sun] != [row[0] for row in earth] or sun[0][0] != scenario.start_utc:
        raise HTTPException(status_code=502, detail="Horizons returned misaligned sample times")

    samples = [
        Sample(
            time_utc=s[0],
            sun=position(s[1], s[2], profile, is_sun=True),
            earth=position(e[1], e[2], profile, clearance=scenario.constraints.min_earth_elevation_deg, is_sun=False),
        )
        for s, e in zip(sun, earth)
        if s[0] < scenario.end_utc
    ]
    if not samples:
        raise HTTPException(status_code=502, detail="Horizons returned no samples in the requested interval")
    timeline = build_timeline(scenario, samples)
    timeline.transition_resolution_minutes = effective_step
    if scenario.refine_transitions:
        timeline.refined_transition_resolution_minutes = effective_step
        for event in timeline.events:
            event.method = "horizons_refined"
    try:
        timeline = apply_refined_events(scenario, timeline)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    result = ScenarioResult(
        scenario=scenario,
        samples=samples,
        horizon_profile=profile,
        metrics=analyze(scenario, timeline),
        timeline=timeline,
        horizon_source=source,
        site_height_km_used=site.height_km,
        terrain_sources=sorted({p.obstacle_source for p in profile or [] if p.obstacle_source}),
        fine_coverage_km=5 if source == "LOLA_20M_NEAR_240M_FAR" else 0,
    )
    if scenario.spatial_uncertainty_radius_m and scenario.use_dem_horizon and dem is not None:
        variations = [result.metrics]

        async def _eval_neighbor(bearing: int):
            latitude, longitude = _destination(
                site.latitude_deg, site.longitude_deg, bearing, scenario.spatial_uncertainty_radius_m
            )
            if longitude > 180:
                longitude -= 360
            if longitude < -180:
                longitude += 360
            nearby = Site(latitude_deg=latitude, longitude_deg=longitude)
            try:
                nearby_profile, nearby_height_km = await run_in_threadpool(
                    horizon_profile,
                    dem,
                    nearby,
                    observer_height_m=scenario.observer_height_m,
                    max_distance_km=scenario.max_horizon_distance_km,
                    azimuth_step_deg=5,
                    fine_dem=fine_dem,
                )
            except TerrainError:
                return None, False
            nearby_site = nearby.model_copy(update={"height_km": nearby_height_km})
            recomputed = False
            n_sun, n_earth = sun, earth
            try:
                n_sun_cand, n_earth_cand = await asyncio.gather(
                    horizons.positions(10, nearby_site, scenario.start_utc, scenario.end_utc, effective_step),
                    horizons.positions(399, nearby_site, scenario.start_utc, scenario.end_utc, effective_step),
                )
                if len(n_sun_cand) == len(sun) and len(n_earth_cand) == len(earth):
                    n_sun, n_earth = n_sun_cand, n_earth_cand
                    recomputed = True
            except HorizonsError:
                pass
            nearby_samples = [
                Sample(
                    time_utc=s[0],
                    sun=position(s[1], s[2], nearby_profile, is_sun=True),
                    earth=position(
                        e[1],
                        e[2],
                        nearby_profile,
                        clearance=scenario.constraints.min_earth_elevation_deg,
                        is_sun=False,
                    ),
                )
                for s, e in zip(n_sun, n_earth)
                if s[0] < scenario.end_utc
            ]
            nearby_timeline = build_timeline(scenario, nearby_samples)
            return analyze(scenario, nearby_timeline), recomputed

        neighbor_results = await asyncio.gather(*(_eval_neighbor(b) for b in (0, 90, 180, 270)))
        recomputed_offsets = 0
        spatial_sites = 1
        for metrics_item, recomputed in neighbor_results:
            if metrics_item is not None:
                variations.append(metrics_item)
                spatial_sites += 1
                if recomputed:
                    recomputed_offsets += 1

        upper_prof, lower_prof, dem_stats = dem_error_envelopes(
            profile,
            uses_fine_site=(source == "LOLA_20M_NEAR_240M_FAR"),
            dem_vertical_error_m=scenario.dem_vertical_error_m,
            sigma_multiplier=scenario.landing_dispersion_sigma,
        )
        for env_prof in (upper_prof, lower_prof):
            env_samples = [
                Sample(
                    time_utc=s[0],
                    sun=position(s[1], s[2], env_prof, is_sun=True),
                    earth=position(
                        e[1],
                        e[2],
                        env_prof,
                        clearance=scenario.constraints.min_earth_elevation_deg,
                        is_sun=False,
                    ),
                )
                for s, e in zip(sun, earth)
                if s[0] < scenario.end_utc
            ]
            variations.append(analyze(scenario, build_timeline(scenario, env_samples)))

        def bounds(field: str, multiplier: float = 1) -> list[float]:
            values = [round(getattr(item, field) * multiplier, 3) for item in variations]
            return [min(values), max(values)]

        all_recomputed = spatial_sites > 1 and recomputed_offsets == (spatial_sites - 1)
        result.spatial_uncertainty = {
            "radius_m": scenario.spatial_uncertainty_radius_m,
            "sites_evaluated": spatial_sites,
            "ephemeris_recomputed_per_offset": all_recomputed,
            "dem_vertical_error_m": dem_stats["dem_vertical_sigma_m"],
            "dem_vertical_sigma_m": dem_stats["dem_vertical_sigma_m"],
            "landing_dispersion_sigma": dem_stats["landing_dispersion_sigma"],
            "horizon_elevation_sigma_deg": dem_stats["horizon_elevation_sigma_deg"],
            "horizon_envelope_deg": dem_stats["horizon_envelope_deg"],
            "confidence_calibrated": False,
            "sunlit_percent_range": bounds("sunlit_fraction", 100),
            "earth_visible_percent_range": bounds("earth_visible_fraction", 100),
            "longest_darkness_hours_range": bounds("longest_darkness_hours"),
            "longest_earth_blackout_hours_range": bounds("longest_earth_blackout_hours"),
            "method": (
                f"Center + 4 cardinal offsets (±{scenario.spatial_uncertainty_radius_m:g}m, Horizons recomputed per offset) "
                f"+ {dem_stats['landing_dispersion_sigma']:g}-sigma conditional DEM vertical band ({dem_stats['dem_vertical_sigma_m']}m -> median ±{dem_stats['horizon_envelope_deg']}°); not calibrated as confidence interval."
                if all_recomputed
                else f"Center + cardinal offsets + {dem_stats['landing_dispersion_sigma']:g}-sigma conditional DEM vertical band ({dem_stats['dem_vertical_sigma_m']}m); not calibrated, center Horizons reused where offset failed."
            ),
        }
    return result


@app.post("/api/v1/scenarios/evaluate", response_model=ScenarioResult, tags=["Scenarios"])
async def evaluate_scenario(scenario: Scenario, request: Request) -> ScenarioResult:
    return await evaluate(scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)


@app.post("/api/v1/scenarios/compare", response_model=list[ScenarioResult], tags=["Scenarios"])
async def compare_scenarios(payload: CompareRequest, request: Request) -> list[ScenarioResult]:
    return [await evaluate(scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem) for scenario in payload.scenarios]


# ---------------------------------------------------------------------------
# Multi-Scenario Ranking & Trade-off Assessment
# ---------------------------------------------------------------------------


@app.post("/api/v1/scenarios/rank", response_model=RankingResponse, tags=["Scenarios"])
async def rank_evaluated_scenarios(payload: RankRequest, request: Request) -> RankingResponse:
    results = [await evaluate(scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem) for scenario in payload.scenarios]
    return rank_scenarios(results, payload.weights)


# ---------------------------------------------------------------------------
# Mission Delta — Operational & Temporal Sensitivity Assessment
# ---------------------------------------------------------------------------


@app.post("/api/v1/scenarios/delta", response_model=MissionDeltaResult, tags=["Mission Delta"])
async def evaluate_mission_delta(payload: MissionDeltaRequest, request: Request) -> MissionDeltaResult:
    base_sc = payload.baseline_scenario

    # Calculate shifted lunar location if displacement is requested
    dest_lat, dest_lon = shift_lunar_coordinates(
        lat_deg=base_sc.site.latitude_deg,
        lon_deg=base_sc.site.longitude_deg,
        azimuth_deg=payload.displacement_azimuth_deg,
        distance_m=payload.displacement_meters,
    )
    shifted_label = base_sc.site.label or "Sitio"
    if payload.displacement_meters > 0:
        shifted_label = f"{shifted_label} (+{int(payload.displacement_meters)}m {int(payload.displacement_azimuth_deg)}°)"

    rescheduled_site = base_sc.site.model_copy(
        update={
            "latitude_deg": dest_lat,
            "longitude_deg": dest_lon,
            "label": shifted_label,
        }
    )

    # Calculate shifted mission time window
    delay = timedelta(days=payload.delay_days, hours=payload.delay_hours)
    rescheduled_start = base_sc.start_utc + delay
    rescheduled_end = base_sc.end_utc + delay
    total_delay_hours = delay.total_seconds() / 3600.0

    rescheduled_sc = base_sc.model_copy(
        update={
            "site": rescheduled_site,
            "start_utc": rescheduled_start,
            "end_utc": rescheduled_end,
        }
    )

    baseline_result = await evaluate(base_sc, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    rescheduled_result = await evaluate(rescheduled_sc, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)

    return compute_mission_delta(
        baseline_result=baseline_result,
        rescheduled_result=rescheduled_result,
        delay_total_hours=total_delay_hours,
        displacement_meters=payload.displacement_meters,
        displacement_azimuth_deg=payload.displacement_azimuth_deg,
    )


# ---------------------------------------------------------------------------
# AI Mission Copilot — Scientific Explanation & Natural Language Guidance
# ---------------------------------------------------------------------------


class CopilotAskRequest(BaseModel):
    scenario: Scenario
    user_query: str | None = Field(default=None, max_length=500)


@app.post("/api/v1/copilot/explain", response_model=CopilotResponse, tags=["AI Copilot"])
def copilot_explain(payload: CopilotRequest) -> CopilotResponse:
    return diagnose_scenario(payload.scenario_result, payload.user_query)


@app.post("/api/v1/copilot/ask", response_model=CopilotResponse, tags=["AI Copilot"])
async def copilot_ask(payload: CopilotAskRequest, request: Request) -> CopilotResponse:
    result = await evaluate(payload.scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    return diagnose_scenario(result, payload.user_query)


@app.post("/api/v1/copilot/parse-constraints", response_model=Constraints, tags=["AI Copilot"])
def copilot_parse_constraints(payload: dict[str, str]) -> Constraints:
    prompt = payload.get("prompt", "")
    return parse_natural_constraints(prompt)



# ---------------------------------------------------------------------------
# Mission Power & Battery Simulation
# ---------------------------------------------------------------------------


@app.post("/api/v1/simulation/power", response_model=PowerSimulationResult, tags=["Simulation"])
async def simulate_mission_power(payload: PowerSimulationRequest, request: Request) -> PowerSimulationResult:
    result = await evaluate(payload.scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    return simulate_power(result, payload.config)


@app.post("/api/v1/simulation/comms", response_model=CommsSimulationResult, tags=["Simulation"])
async def simulate_mission_comms(payload: CommsSimulationRequest, request: Request) -> CommsSimulationResult:
    result = await evaluate(payload.scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    return simulate_comms(result, payload.config)


# ---------------------------------------------------------------------------
# CSV Data Export
# ---------------------------------------------------------------------------


@app.post("/api/v1/scenarios/export/csv", tags=["Export"])
async def export_scenario_csv(scenario: Scenario, request: Request) -> Response:
    result = await evaluate(scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "time_utc",
        "hour_offset",
        "sun_azimuth_deg",
        "sun_elevation_deg",
        "sun_horizon_deg",
        "sun_visible",
        "sun_disk_fraction",
        "sun_disk_state",
        "earth_azimuth_deg",
        "earth_elevation_deg",
        "earth_horizon_deg",
        "earth_visible",
        "earth_disk_fraction",
        "earth_disk_state",
        "site_latitude_deg",
        "site_longitude_deg",
        "ephemeris_source",
        "horizon_source",
        "dem_pixel_scale_m",
        "sampling_minutes",
        "transition_bracket_minutes",
        "precision_note",
        "terrain_sources",
        "fine_coverage_km",
        "observer_height_m",
        "max_horizon_distance_km",
        "sun_obstacle_distance_km",
        "sun_obstacle_source",
        "earth_obstacle_distance_km",
        "earth_obstacle_source",
        "spatial_radius_m",
        "dem_vertical_sigma_m",
        "landing_dispersion_sigma",
        "horizon_envelope_deg",
        "confidence_calibrated",
        "sunlit_percent_range",
        "earth_visible_percent_range",
        "spatial_method",
    ])
    for s in result.samples:
        hour_offset = round((s.time_utc - scenario.start_utc).total_seconds() / 3600.0, 2)
        def obstacle(azimuth: float):
            if not result.horizon_profile:
                return None
            return min(result.horizon_profile,
                       key=lambda point: abs((point.azimuth_deg - azimuth + 180) % 360 - 180))
        sun_obstacle = obstacle(s.sun.azimuth_deg)
        earth_obstacle = obstacle(s.earth.azimuth_deg)
        uncertainty = result.spatial_uncertainty or {}
        writer.writerow([
            s.time_utc.isoformat(),
            hour_offset,
            s.sun.azimuth_deg,
            s.sun.elevation_deg,
            s.sun.horizon_deg,
            s.sun.visible,
            s.sun.disk_fraction,
            s.sun.disk_state,
            s.earth.azimuth_deg,
            s.earth.elevation_deg,
            s.earth.horizon_deg,
            s.earth.visible,
            s.earth.disk_fraction,
            s.earth.disk_state,
            scenario.site.latitude_deg,
            scenario.site.longitude_deg,
            result.ephemeris_source,
            result.horizon_source,
            20 if result.fine_coverage_km else 240 if scenario.use_dem_horizon else "",
            result.timeline.transition_resolution_minutes,
            result.timeline.refined_transition_resolution_minutes or result.timeline.transition_resolution_minutes,
            result.precision_note,
            ";".join(result.terrain_sources),
            result.fine_coverage_km,
            scenario.observer_height_m,
            scenario.max_horizon_distance_km,
            sun_obstacle.obstacle_distance_km if sun_obstacle else "",
            sun_obstacle.obstacle_source if sun_obstacle else "",
            earth_obstacle.obstacle_distance_km if earth_obstacle else "",
            earth_obstacle.obstacle_source if earth_obstacle else "",
            uncertainty.get("radius_m", ""),
            uncertainty.get("dem_vertical_sigma_m", ""),
            uncertainty.get("landing_dispersion_sigma", ""),
            uncertainty.get("horizon_envelope_deg", ""),
            uncertainty.get("confidence_calibrated", ""),
            uncertainty.get("sunlit_percent_range", ""),
            uncertainty.get("earth_visible_percent_range", ""),
            uncertainty.get("method", ""),
        ])
    filename = f"lunar_scenario_{(scenario.site.label or 'site').replace(' ', '_')}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Frontend Compatibility Adapter (supports frontend/src/api.ts)
# ---------------------------------------------------------------------------


@app.post("/api/scenarios/analyze", response_model=LegacyAnalyzeResponse, tags=["Frontend Adapter"])
@app.post("/api/v1/scenarios/analyze", response_model=LegacyAnalyzeResponse, tags=["Frontend Adapter"])
async def analyze_legacy(payload: LegacyAnalyzeRequest, request: Request) -> LegacyAnalyzeResponse:
    end_time = payload.start_time + timedelta(hours=payload.hours)
    scenario = Scenario(
        site=Site(latitude_deg=payload.latitude, longitude_deg=payload.longitude, height_km=payload.height_km),
        start_utc=payload.start_time,
        end_utc=end_time,
        step_minutes=payload.step_minutes,
        refine_transitions=payload.refine_transitions,
        refinement_step_minutes=payload.refinement_step_minutes,
        use_dem_horizon=payload.use_dem_horizon,
        observer_height_m=payload.observer_height_m,
        max_horizon_distance_km=payload.max_horizon_distance_km,
        spatial_uncertainty_radius_m=payload.spatial_uncertainty_radius_m,
        dem_vertical_error_m=payload.dem_vertical_error_m,
        landing_dispersion_sigma=payload.landing_dispersion_sigma,
        constraints=Constraints(min_earth_elevation_deg=payload.min_earth_elevation_deg),
    )
    result = await evaluate(scenario, request.app.state.horizons, request.app.state.dem, request.app.state.fine_dem)
    legacy_samples = [
        LegacySample(
            hour=int(round((s.time_utc - payload.start_time).total_seconds() / 3600.0)),
            hour_offset=round((s.time_utc - payload.start_time).total_seconds() / 3600.0, 4),
            time_utc=s.time_utc,
            sun_azimuth=s.sun.azimuth_deg,
            earth_azimuth=s.earth.azimuth_deg,
            sun_elevation=s.sun.elevation_deg,
            earth_elevation=s.earth.elevation_deg,
            horizon_sun=s.sun.horizon_deg,
            horizon_earth=s.earth.horizon_deg,
            sun_visible=s.sun.visible,
            earth_visible=s.earth.visible,
            sun_disk_fraction=s.sun.disk_fraction,
            earth_disk_fraction=s.earth.disk_fraction,
        )
        for s in result.samples
    ]
    return LegacyAnalyzeResponse(
        site={
            "lat": payload.latitude,
            "lon": payload.longitude,
            "height_km": result.site_height_km_used,
        },
        start=payload.start_time.strftime("%Y-%m-%d"),
        hours=payload.hours,
        samples=legacy_samples,
        horizon_profile=result.horizon_profile,
        source=result.horizon_source,
        metrics={
            "sunPercent": round(result.metrics.sunlit_fraction * 100),
            "earthPercent": round(result.metrics.earth_visible_fraction * 100),
            "concurrentPercent": round(result.metrics.concurrent_fraction * 100),
            "longestDark": result.metrics.longest_darkness_hours,
            "longestBlackout": result.metrics.longest_earth_blackout_hours,
        },
        ephemeris_source=result.ephemeris_source,
        dem_pixel_scale_m=(20 if result.fine_coverage_km else 240) if payload.use_dem_horizon else None,
        terrain_sources=result.terrain_sources,
        spatial_uncertainty=result.spatial_uncertainty,
        events=result.timeline.events,
        sampling_minutes=result.timeline.transition_resolution_minutes,
        transition_uncertainty_minutes=result.timeline.transition_resolution_minutes,
        precision_note=result.precision_note,
    )


# ---------------------------------------------------------------------------
# Illumination calendar
# ---------------------------------------------------------------------------


class IlluminationCalendarRequest(BaseModel):
    latitude: float = Field(ge=-90, le=-75)
    longitude: float = Field(ge=-180, le=180)
    year: int = Field(ge=1900, le=2200)
    month: int = Field(ge=1, le=12)
    step_minutes: int = Field(default=60, ge=10, le=180)


class IlluminationDay(BaseModel):
    date: str
    sunlit_percent: float
    level: str
    max_sun_elevation_deg: float
    max_clearance_deg: float
    best_time_utc: str
    sun_azimuth_deg: float
    sun_elevation_deg: float


class IlluminationCalendarResponse(BaseModel):
    latitude: float
    longitude: float
    year: int
    month: int
    horizon_source: str
    thresholds: dict[str, float]
    days: list[IlluminationDay]


CALENDAR_THRESHOLDS = {"favorable": 70.0, "partial": 30.0}


def _illumination_level(sunlit_percent: float) -> str:
    if sunlit_percent <= 0:
        return "none"
    if sunlit_percent >= CALENDAR_THRESHOLDS["favorable"]:
        return "favorable"
    if sunlit_percent >= CALENDAR_THRESHOLDS["partial"]:
        return "partial"
    return "minimal"


@app.post("/api/v1/illumination/calendar", response_model=IlluminationCalendarResponse, tags=["Scenarios"])
async def illumination_calendar(payload: IlluminationCalendarRequest, request: Request) -> IlluminationCalendarResponse:
    from calendar import monthrange
    from datetime import datetime, timezone

    dem: LolaDem | None = request.app.state.dem
    if dem is None:
        raise HTTPException(status_code=503, detail="LOLA DEM is not installed; run scripts/download_lola.py")
    site = Site(latitude_deg=payload.latitude, longitude_deg=payload.longitude)
    profiles: dict = request.app.state.calendar_profiles
    key = (round(site.latitude_deg, 4), round(site.longitude_deg, 4))
    if key not in profiles:
        try:
            profiles[key] = await run_in_threadpool(horizon_profile, dem, site, fine_dem=request.app.state.fine_dem)
        except (TerrainError, ValueError) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    profile, height_km = profiles[key]
    site = site.model_copy(update={"height_km": height_km})

    start = datetime(payload.year, payload.month, 1, tzinfo=timezone.utc)
    end = start + timedelta(days=monthrange(payload.year, payload.month)[1])
    try:
        rows = await request.app.state.horizons.positions(10, site, start, end, payload.step_minutes)
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    by_day: dict[str, list] = {}
    for time_utc, azimuth, elevation in rows:
        if time_utc >= end:
            continue
        by_day.setdefault(time_utc.strftime("%Y-%m-%d"), []).append((time_utc, azimuth, elevation, position(azimuth, elevation, profile, is_sun=True)))

    days: list[IlluminationDay] = []
    for date, samples in sorted(by_day.items()):
        lit = sum(1 for *_, pos in samples if pos.visible)
        sunlit_percent = round(100 * lit / len(samples), 1)
        best = max(samples, key=lambda item: item[2] - item[3].horizon_deg)
        days.append(IlluminationDay(
            date=date,
            sunlit_percent=sunlit_percent,
            level=_illumination_level(sunlit_percent),
            max_sun_elevation_deg=round(max(item[2] for item in samples), 3),
            max_clearance_deg=round(best[2] - best[3].horizon_deg, 3),
            best_time_utc=best[0].strftime("%Y-%m-%dT%H:%M:%SZ"),
            sun_azimuth_deg=round(best[1], 3),
            sun_elevation_deg=round(best[2], 3),
        ))
    source = "LOLA_20M_NEAR_240M_FAR" if any(p.obstacle_pixel_scale_m == 20 for p in profile) else "LOLA_LDEM_75S_240M_PDS"
    return IlluminationCalendarResponse(
        latitude=payload.latitude, longitude=payload.longitude, year=payload.year, month=payload.month,
        horizon_source=source, thresholds=CALENDAR_THRESHOLDS, days=days,
    )


# ---------------------------------------------------------------------------
# Ephemeris Cache Management
# ---------------------------------------------------------------------------


@app.get("/api/v1/cache/stats", tags=["Cache"])
def cache_stats(request: Request) -> dict[str, int | bool]:
    cache: EphemerisCache | None = request.app.state.cache
    if cache is None:
        return {"enabled": False, "cached_entries": 0}
    return {"enabled": True, "cached_entries": cache.count()}


@app.post("/api/v1/cache/clear", tags=["Cache"])
def clear_cache(request: Request) -> dict[str, int]:
    cache: EphemerisCache | None = request.app.state.cache
    if cache is None:
        return {"cleared_entries": 0}
    return {"cleared_entries": cache.clear()}
