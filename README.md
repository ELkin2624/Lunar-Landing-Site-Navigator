# LunarPath AI — Lunar Landing Site Navigator

NASA Space Apps Challenge 2026 · Team Moon Bytes · Santa Cruz de la Sierra, Bolivia

LunarPath AI is an interactive educational web tool for planning simulated missions to the lunar South Pole. Users choose candidate sites and a date and see when and where there is sunlight and a direct line of sight to Earth, compare sites with an explainable ranking, browse an illumination calendar and estimate battery energy. Results are estimates for planning and education: they do not certify landing safety or radio links.

## Repository

- [`backend/`](backend/README.md): FastAPI scientific API (JPL Horizons ephemerides, LOLA terrain horizons, metrics, ranking).
- [`frontend/`](frontend/README.md): React + Three.js interface.
- [`docs/`](docs/): project goals and scientific validation reports.

## NASA data and resources

| Resource | Use |
|---|---|
| [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) | Sun and Earth positions seen from each lunar site |
| [LRO LOLA gridded data (PDS)](https://pds-geosciences.wustl.edu/missions/lro/lola.htm) | South Pole terrain (240 m and 20 m) for horizon and slope |
| [NASA Moon Trek](https://trek.nasa.gov/moon/) | Polar maps and tiles in the interface |
| [LROC NAC DTMs (PDS)](https://pds.lroc.asu.edu/data/LRO-L-LROC-5-RDR-V1.0/) | 2 m terrain models for validation and local roughness |
| [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) | Moon colour and relief on the landing page |
| [NASA NAIF SPICE kernels](https://naif.jpl.nasa.gov/naif/data_generic.html) | Independent validation of Horizons positions |

Landing-page stars come from the ESA Hipparcos catalogue (via d3-celestial).

## AI usage

We used **Claude Code (Anthropic)** as an AI coding assistant. It was used for:

- **Coding, debugging and troubleshooting:** reviewing the FastAPI backend and React/Three.js frontend, writing unit tests, and fixing UI layout, contrast and 3D camera issues.
- **Data analysis:** running real JPL Horizons queries, checking LOLA DEM projection and reference frames, measuring the effect of horizon ray range, and verifying site coordinates against the IAU Gazetteer of Planetary Nomenclature (which found a wrong longitude for Mons Mouton).
- **Data processing:** writing [`frontend/scripts/build_landing_assets.py`](frontend/scripts/build_landing_assets.py), which converts CGI Moon Kit data into web textures.
- **Visual design:** the landing-page layout, the 3D Moon scene and the starfield.
- **Ideation, research and writing:** defining the MVP and user flows, finding NASA data sources, and drafting and translating the project summary.

All scientific results come from NASA data processed by our own code; the AI did not generate data or imagery. AI-assisted changes were reviewed and tested before being pushed.
