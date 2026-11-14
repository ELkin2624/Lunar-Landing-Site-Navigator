# LunarPath AI backend

API inicial para comparar iluminación solar y visibilidad directa de la Tierra desde puntos de la Luna. Consulta **JPL Horizons** en tiempo real y devuelve series temporales, ventanas y métricas. No incluye todavía datos LOLA: sin `horizon_profile`, el horizonte es el plano geométrico de 0°. Una curva suministrada por el cliente se interpola circularmente, pero la API no certifica su procedencia ni su datum.

## Python y arranque

Se recomienda **Python 3.12** para el desarrollo local. Python 3.14 también puede ejecutar esta base, pero 3.12 reduce el riesgo de incompatibilidades al añadir Rasterio/GDAL y otras dependencias científicas. La restricción declarada en `pyproject.toml` admite 3.12–3.14; `.python-version` fija la recomendación local.

En PowerShell, desde `backend`:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -e '.[dev]'
.venv\Scripts\python -m uvicorn app.main:app --reload
```

API en `http://127.0.0.1:8000`; documentación interactiva en `/docs`. Se requiere conexión a JPL Horizons. `GET /health` solo comprueba que el proceso responde.
Para otro origen de frontend, configura `LUNARPATH_CORS_ORIGINS` con una lista separada por comas.

## Endpoints

- `POST /api/v1/scenarios/evaluate`: un sitio y rango temporal.
- `POST /api/v1/scenarios/compare`: de 2 a 5 escenarios.

Ejemplo:

```json
{
  "site": {"latitude_deg": -89.5, "longitude_deg": 0, "height_km": 0, "label": "Punto de ejemplo"},
  "start_utc": "2026-11-15T00:00:00Z",
  "end_utc": "2026-11-16T00:00:00Z",
  "step_minutes": 60,
  "constraints": {
    "min_sunlit_fraction": 0.5,
    "min_earth_visible_fraction": 0.5,
    "max_darkness_hours": 12,
    "max_earth_blackout_hours": 12,
    "min_earth_elevation_deg": 0
  }
}
```

`height_km` es la altura sobre el elipsoide lunar usado por Horizons; **0 no significa que se haya medido la elevación real del terreno**. Las coordenadas del ejemplo no representan un sitio aprobado para aterrizar.

El campo opcional `horizon_profile` recibe puntos ordenados por azimut, por ejemplo `[{"azimuth_deg":0,"elevation_deg":2},{"azimuth_deg":180,"elevation_deg":4}]`. La visibilidad se evalúa con `elevation > horizonte` y para la Tierra se suma el ángulo mínimo de antena. Los cuerpos se modelan como puntos; no se considera visibilidad parcial del disco, terreno no aportado, inclinación de paneles, potencia eléctrica ni enlace de radio.

Las ventanas se aproximan en los instantes de muestreo; aumentar la resolución temporal mejora la estimación, pero puede perder eventos entre muestras. El intervalo máximo es 14 días y 500 pasos. Los tiempos de entrada deben incluir zona horaria y se normalizan a UTC. Una caída o respuesta inesperada de Horizons devuelve HTTP 502.

## Próximos módulos

1. Ingestar un DEM LOLA con metadatos de proyección y datum verificados.
2. Calcular perfiles de horizonte lunar con curvatura y altura del observador.
3. Refinar cruces de visibilidad y validar contra casos de referencia de Horizons.
4. Añadir catálogo de coordenadas documentadas y caché persistente para demostraciones.

Fuentes: [API Horizons](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [datos LOLA en NASA PDS](https://pds-geosciences.wustl.edu/missions/lro/lola.htm).
