# LunarPath AI — Frontend

Interfaz React + TypeScript + Vite para explorar sitios del polo sur lunar, recorrer una línea temporal de visibilidad Sol/Tierra, comparar dos escenarios y evaluar restricciones básicas de misión.

## Ejecutar

```bash
cd frontend
npm install
npm run dev
```

Abre la URL local que muestra Vite. Para compilar: `npm run build`.

## Datos y API

El repositorio incluye un backend FastAPI en `../backend`. El mapa permite alternar una imagen óptica LROC WAC v2 servida por NASA Moon Trek y un relieve generado del DEM LOLA `LDEM_75S_240M`; ambas se alinean en la proyección estereográfica polar sur. Los marcadores se calculan con la misma transformación geográfica que usa el backend. La foto WAC reúne imágenes de varias fechas y el sombreado LOLA es una visualización: ninguna capa representa la iluminación de la fecha seleccionada. Con la API activa, la vista de horizonte traza el perfil LOLA y coloca el Sol y la Tierra según JPL Horizons. En modo demo, esa vista sigue siendo una **ilustración**. Las coordenadas de los puntos son muestras de interfaz, no ubicaciones de aterrizaje aprobadas.

El PNG de relieve se puede regenerar con `python frontend/scripts/generate_polar_map.py` desde la raíz del repositorio, después de descargar el IMG y LBL de [NASA PDS Geosciences](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/). La foto se puede regenerar con `python frontend/scripts/download_moontrek_wac.py` (requiere Pillow) a partir del [WMTS de NASA Moon Trek](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon), capa `LRO_WAC_Mosaic_SPole60_100m_v02`, proyección `IAU2000::30120`. Ambas imágenes incluidas cubren 192 km desde el polo en cada dirección y funcionan sin clave API en tiempo de ejecución. El enlace “Abrir NASA Moon Trek” abre el portal oficial; aún no centra automáticamente la vista porque no se ha verificado el formato actual de enlace compartido.

Puedes pulsar cualquier punto del mapa o escribir latitud y longitud en el formulario. La selección se limita al recorte visible; el frontend invierte la proyección polar y envía las coordenadas al mismo análisis de Horizons y LOLA. El punto personalizado aparece en el mapa y se puede comparar con una región del catálogo. Se redondea a 0,001° para la entrada; la resolución del relieve sigue siendo de 240 m/píxel. Cada columna de comparación indica si usa API o demo.

Por defecto se utiliza la demo. Para activar el backend, copia `.env.example` a `.env` y ejecuta el backend. El cliente consulta `POST /api/scenarios/analyze` para los dos sitios de la comparación, usa las métricas devueltas por FastAPI y pide horizonte LOLA. Si falla una consulta, muestra un aviso explícito y datos de demostración identificados como ilustrativos. En desarrollo, Vite redirige `/api` a `http://localhost:8000`. Para otro destino, configura `VITE_API_BASE_URL`.

Solicitud esperada:

```json
{
  "latitude": -85.4,
  "longitude": -29.2,
  "start_time": "2026-11-15T00:00:00Z",
  "hours": 168,
  "step_minutes": 60,
  "use_dem_horizon": true
}
```

Respuesta esperada:

```json
{
  "samples": [
    {
      "hour": 0,
      "sun_azimuth": 122.0,
      "earth_azimuth": 285.0,
      "sun_elevation": 2.1,
      "earth_elevation": 4.7,
      "horizon_sun": 1.8,
      "horizon_earth": 2.2,
      "sun_visible": true,
      "earth_visible": true
    }
  ],
  "horizon_profile": [{"azimuth_deg": 0, "elevation_deg": 1.2}]
}
```

Se esperan al menos dos muestras horarias, métricas y un perfil de horizonte completo del backend. La API proporciona efemérides y horizonte topográfico; el frontend solo los dibuja. La exposición de los discos y las ventanas se calculan en el backend.

## Alcance actual

- Selección entre cuatro regiones de muestra o un punto personalizado del mapa, y fecha UTC.
- Visibilidad solar y terrestre, intervalos de oscuridad y blackout, gráfico temporal y control de hora.
- Modo Analyst con umbrales ajustables.
- Comparación de dos sitios y exportación CSV del escenario principal.
- Diseño adaptable para escritorio y móvil.

Quedan pendientes una capa NAC de mayor resolución, zoom y navegación, la vista 3D y la validación de ubicaciones exactas de aterrizaje. El WAC de 100 m/píxel se remuestrea a 480 m/píxel en el PNG incluido; no permite evaluar rocas o peligros pequeños. El DEM LOLA de 240 m/píxel tampoco certifica una zona de contacto segura.
