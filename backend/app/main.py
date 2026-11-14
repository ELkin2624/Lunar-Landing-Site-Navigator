from contextlib import asynccontextmanager
import os

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .analysis import analyze, position
from .horizons import HorizonsClient, HorizonsError
from .models import CompareRequest, Sample, Scenario, ScenarioResult


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with httpx.AsyncClient(timeout=30, limits=httpx.Limits(max_connections=10)) as client:
        app.state.horizons = HorizonsClient(client)
        yield


app = FastAPI(title="LunarPath AI API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("LUNARPATH_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if origin.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


async def evaluate(scenario: Scenario, horizons: HorizonsClient) -> ScenarioResult:
    try:
        sun = await horizons.positions(10, scenario.site, scenario.start_utc, scenario.end_utc, scenario.step_minutes)
        earth = await horizons.positions(399, scenario.site, scenario.start_utc, scenario.end_utc, scenario.step_minutes)
    except HorizonsError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if [row[0] for row in sun] != [row[0] for row in earth] or sun[0][0] != scenario.start_utc:
        raise HTTPException(status_code=502, detail="Horizons returned misaligned sample times")
    samples = [Sample(time_utc=s[0],
                      sun=position(s[1], s[2], scenario.horizon_profile),
                      earth=position(e[1], e[2], scenario.horizon_profile, scenario.constraints.min_earth_elevation_deg))
               for s, e in zip(sun, earth) if s[0] < scenario.end_utc]
    if not samples:
        raise HTTPException(status_code=502, detail="Horizons returned no samples in the requested interval")
    return ScenarioResult(scenario=scenario, samples=samples, metrics=analyze(scenario, samples),
                          horizon_source="user_supplied_profile" if scenario.horizon_profile else "geometric_0_deg")


@app.post("/api/v1/scenarios/evaluate", response_model=ScenarioResult)
async def evaluate_scenario(scenario: Scenario, request: Request) -> ScenarioResult:
    return await evaluate(scenario, request.app.state.horizons)


@app.post("/api/v1/scenarios/compare", response_model=list[ScenarioResult])
async def compare_scenarios(payload: CompareRequest, request: Request) -> list[ScenarioResult]:
    return [await evaluate(scenario, request.app.state.horizons) for scenario in payload.scenarios]
