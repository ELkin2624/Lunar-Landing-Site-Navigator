"""Real end-to-end verification against live FastAPI + Uvicorn (zero mockups).

Usage:
    python scripts/run_e2e_real.py [base_url]
"""
from __future__ import annotations

import json
import sys
import time
import httpx


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"


def main() -> int:
    t0 = time.perf_counter()
    results: dict[str, dict] = {}

    with httpx.Client(base_url=BASE_URL, timeout=60.0) as client:
        # 1. Health & Sites catalog
        r_health = client.get("/health")
        assert r_health.status_code == 200, f"/health failed: {r_health.text}"
        health = r_health.json()
        assert health.get("status") == "ok"

        r_sites = client.get("/api/v1/sites")
        assert r_sites.status_code == 200
        sites = r_sites.json()
        assert len(sites) >= 5
        results["catalog"] = {"sites_count": len(sites), "health": health}

        # 2. Legacy /analyze on Mons Mouton (240 m DEM + 3sigma)
        start_iso = "2026-11-15T00:00:00Z"
        r_mouton = client.post(
            "/api/scenarios/analyze",
            json={
                "latitude": -84.6,
                "longitude": 31.0,
                "start_time": start_iso,
                "hours": 72,
                "step_minutes": 60,
                "use_dem_horizon": True,
                "refine_transitions": False,
            },
        )
        assert r_mouton.status_code == 200, f"Mouton analyze failed: {r_mouton.text}"
        mouton = r_mouton.json()
        assert mouton["dem_pixel_scale_m"] == 240.0
        assert "LDEM_75S_240M" in mouton["terrain_sources"]
        assert mouton["spatial_uncertainty"]["dem_vertical_sigma_m"] == 18.0
        assert mouton["spatial_uncertainty"]["landing_dispersion_sigma"] == 3.0
        assert len(mouton["horizon_profile"]) == 360
        assert len(mouton["samples"]) == 72
        results["mons_mouton_240m"] = {
            "samples": len(mouton["samples"]),
            "sun_pct": mouton["metrics"]["sunPercent"],
            "earth_pct": mouton["metrics"]["earthPercent"],
            "horizon_envelope_deg": mouton["spatial_uncertainty"]["horizon_envelope_deg"],
        }

        # 3. Legacy /analyze on de Gerlache Rim 2 (20m + 240m hybrid + 5-min transition refinement)
        r_gerlache = client.post(
            "/api/scenarios/analyze",
            json={
                "latitude": -88.3,
                "longitude": -59.5,
                "start_time": start_iso,
                "hours": 72,
                "step_minutes": 30,
                "use_dem_horizon": True,
                "refine_transitions": True,
                "refinement_step_minutes": 5,
            },
        )
        assert r_gerlache.status_code == 200, f"de Gerlache analyze failed: {r_gerlache.text}"
        ger = r_gerlache.json()
        assert ger["dem_pixel_scale_m"] == 20.0
        assert "LDEM_875S_20M" in ger["terrain_sources"]
        assert "LDEM_75S_240M" in ger["terrain_sources"]
        assert ger["transition_uncertainty_minutes"] == 5
        assert len(ger["samples"]) == 864
        assert ger["spatial_uncertainty"]["dem_vertical_sigma_m"] == 2.7
        results["de_gerlache_20m_refined"] = {
            "samples": len(ger["samples"]),
            "events": len(ger["events"]),
            "sun_pct": ger["metrics"]["sunPercent"],
            "earth_pct": ger["metrics"]["earthPercent"],
            "terrain_sources": ger["terrain_sources"],
        }

        # 4. Regional slope in 20 m/px vs 240 m/px
        r_s20 = client.post(
            "/api/v1/terrain/slope",
            json={"site": {"latitude_deg": -88.3, "longitude_deg": -59.5}, "baseline_pixels": 1, "neighborhood_radius_m": 1000, "threshold_deg": 15},
        )
        r_s240 = client.post(
            "/api/v1/terrain/slope",
            json={"site": {"latitude_deg": -84.6, "longitude_deg": 31.0}, "baseline_pixels": 1, "neighborhood_radius_m": 1000, "threshold_deg": 15},
        )
        assert r_s20.status_code == 200 and r_s240.status_code == 200, (r_s20.text, r_s240.text)
        s20, s240 = r_s20.json(), r_s240.json()
        assert s20["pixel_scale_m"] == 20.0
        assert s240["pixel_scale_m"] == 240.0
        results["slope"] = {
            "gerlache_20m_deg": s20["slope_deg"],
            "mouton_240m_deg": s240["slope_deg"],
        }

        # 5. Terrain 3D mesh
        r_mesh = client.post(
            "/api/v1/terrain/mesh",
            json={"site": {"latitude_deg": -88.3, "longitude_deg": -59.5}},
        )
        assert r_mesh.status_code == 200, r_mesh.text
        mesh = r_mesh.json()
        assert len(mesh["heights_m"]) == mesh["grid_size"] * mesh["grid_size"]
        results["mesh"] = {"grid_size": mesh["grid_size"], "source": mesh.get("source")}

        # 6. NAC texture & disk cache hit test
        tex_params = {"latitude_deg": -88.3, "longitude_deg": -59.5, "span_m": 2000}
        r_tex1 = client.get("/api/v1/terrain/nac-texture", params=tex_params)
        r_tex2 = client.get("/api/v1/terrain/nac-texture", params=tex_params)
        assert r_tex1.status_code == 200 and r_tex2.status_code == 200, (r_tex1.text, r_tex2.text)
        assert r_tex1.headers.get("content-type", "").startswith("image/png")
        assert r_tex2.headers.get("x-texture-cache") == "hit"
        results["nac_texture"] = {
            "bytes": len(r_tex1.content),
            "cache_1": r_tex1.headers.get("x-texture-cache"),
            "cache_2": r_tex2.headers.get("x-texture-cache"),
            "coverage_fraction": r_tex2.headers.get("x-tile-coverage-fraction"),
        }

        # 7. Power & Comms simulation on real de Gerlache scenario
        scenario_payload = {
            "site": {"latitude_deg": -88.3, "longitude_deg": -59.5, "label": "de Gerlache Rim 2"},
            "start_utc": start_iso,
            "end_utc": "2026-11-18T00:00:00Z",
            "step_minutes": 60,
            "use_dem_horizon": True,
            "spatial_uncertainty_radius_m": 240,
        }
        r_pwr = client.post("/api/v1/simulation/power", json={"scenario": scenario_payload, "config": {}})
        r_com = client.post("/api/v1/simulation/comms", json={"scenario": scenario_payload, "config": {"band": "X", "peak_downlink_mbps": 10.0, "daily_data_generation_gb": 12.0, "buffer_capacity_gb": 32.0}})
        assert r_pwr.status_code == 200 and r_com.status_code == 200, (r_pwr.text, r_com.text)
        pwr, com = r_pwr.json(), r_com.json()
        assert len(pwr["steps"]) > 0 and len(com["steps"]) > 0
        results["simulations"] = {
            "power_min_soc_pct": pwr["min_soc_percent"],
            "power_survives": pwr["survives_mission"],
            "comms_viable": com["comms_viable"],
            "comms_downlinked_gb": com["total_downlinked_gb"],
            "comms_peak_ssr_pct": com["peak_buffer_percent"],
        }

        # 8. Mission Delta (delay 1d + 12h = 36h, displacement 240m azimuth 90 deg)
        r_delta = client.post(
            "/api/v1/scenarios/delta",
            json={
                "baseline_scenario": scenario_payload,
                "delay_days": 1,
                "delay_hours": 12,
                "displacement_meters": 240,
                "displacement_azimuth_deg": 90,
            },
        )
        assert r_delta.status_code == 200, r_delta.text
        delta = r_delta.json()
        results["mission_delta"] = {
            "risk_level": delta["risk_level"],
            "delta_sun_pct": delta["metrics"]["delta_sunlit_percent"],
        }

        # 9. Multi-criteria Ranking across 3 sites
        r_rank = client.post(
            "/api/v1/scenarios/rank",
            json={
                "scenarios": [
                    scenario_payload,
                    {**scenario_payload, "site": {"latitude_deg": -84.6, "longitude_deg": 31.0, "label": "Mons Mouton"}},
                    {**scenario_payload, "site": {"latitude_deg": -89.4, "longitude_deg": -137.5, "label": "Connecting Ridge"}},
                ],
                "weights": {"sun": 0.4, "earth": 0.3, "concurrent": 0.15, "darkness_penalty": 0.1, "blackout_penalty": 0.05},
            },
        )
        assert r_rank.status_code == 200, r_rank.text
        rank_body = r_rank.json()
        assert len(rank_body["ranked_sites"]) == 3
        results["ranking"] = [
            {"rank": x["rank"], "label": x["label"], "score": x["score"]}
            for x in rank_body["ranked_sites"]
        ]

        # 10. Copilot Ask, Parse-Constraints & Backend CSV Export
        r_ask = client.post(
            "/api/v1/copilot/ask",
            json={"scenario": scenario_payload, "user_query": "¿Cuál es la capacidad de enlace DSN y el blackout máximo?"},
        )
        r_parse = client.post(
            "/api/v1/copilot/parse-constraints",
            json={"prompt": "al menos 60% de sol y máximo 12 horas de blackout"},
        )
        r_csv = client.post("/api/v1/scenarios/export/csv", json=scenario_payload)
        assert r_ask.status_code == 200 and r_parse.status_code == 200 and r_csv.status_code == 200
        csv_text = r_csv.text
        assert "sun_disk_fraction" in csv_text and "earth_disk_fraction" in csv_text and "fine_coverage_km" in csv_text
        results["copilot_and_csv"] = {
            "direct_answer_ok": bool(r_ask.json().get("direct_answer")),
            "parsed_constraints": r_parse.json(),
            "csv_lines": len(csv_text.strip().splitlines()),
        }

    elapsed = round(time.perf_counter() - t0, 2)
    print(json.dumps({"status": "E2E_ALL_PASSED", "elapsed_s": elapsed, "results": results}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
