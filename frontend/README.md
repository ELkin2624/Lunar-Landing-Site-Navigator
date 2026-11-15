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

El repositorio incluye un backend FastAPI en `../backend`. El mapa permite alternar una imagen óptica LROC WAC v2 servida por NASA Moon Trek y un relieve generado del DEM LOLA `LDEM_75S_240M`; ambas se alinean en la proyección estereográfica polar sur. Los marcadores se calculan con la misma transformación geográfica que usa el backend. La foto WAC reúne imágenes de varias fechas y el sombreado LOLA es una visualización: ninguna capa representa la iluminación de la fecha seleccionada. La vista de horizonte traza el perfil LOLA y coloca el Sol y la Tierra según JPL Horizons. Las coordenadas de los puntos son muestras de interfaz, no ubicaciones de aterrizaje aprobadas.

El PNG de relieve se puede regenerar con `python frontend/scripts/generate_polar_map.py` desde la raíz del repositorio, después de descargar el IMG y LBL de [NASA PDS Geosciences](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/). La foto se puede regenerar con `python frontend/scripts/download_moontrek_wac.py` (requiere Pillow) a partir del [WMTS de NASA Moon Trek](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon), capa `LRO_WAC_Mosaic_SPole60_100m_v02`, proyección `IAU2000::30120`. Ambas imágenes incluidas cubren 192 km desde el polo en cada dirección y funcionan sin clave API en tiempo de ejecución. Al acercar, el navegador consulta mosaico LROC NAC y relieve LOLA de 5 m de Moon Trek; la cobertura local puede ser parcial o inexistente y se indica en pantalla.

"Abrir NASA Moon Trek" abre el portal y deja las coordenadas del sitio visibles en la tarjeta para introducirlas en «Fly To». En noviembre de 2026 se observó el formato polar de «Share Link» (coordenadas proyectadas en metros y `IAU2000::30120`), pero un enlace generado para de Gerlache abrió con otro centro y zoom. Por eso la aplicación no promete un enlace centrado ni activa 3D automáticamente.

Puedes pulsar cualquier punto del mapa o escribir latitud y longitud en el formulario. La selección se limita al recorte visible; el frontend invierte la proyección polar y envía las coordenadas al mismo análisis de Horizons y LOLA. El punto personalizado aparece en el mapa y se puede comparar con una región del catálogo. Se redondea a 0,001° para la entrada; la resolución del horizonte y de la pendiente regional sigue siendo de 240 m/píxel.

Por defecto se consulta el backend. Ejecuta FastAPI antes de abrir el frontend; `.env.example` muestra la configuración opcional. El cliente consulta `POST /api/scenarios/analyze`, usa las métricas de FastAPI y pide horizonte LOLA. Si falla, muestra el error y **no sustituye las métricas por datos simulados**. En desarrollo, Vite redirige `/api` a `http://localhost:8000`. Para otro destino, configura `VITE_API_BASE_URL`.

El explorador ahora distingue pendiente regional LOLA de una **huella local NAC estéreo** de 2 m. La huella informa pendiente del plano, rugosidad residual y cobertura, y muestra «sin datos» fuera de los dos DTM disponibles. No detecta rocas ni certifica aterrizaje. El panel de energía permite variar pérdidas solares y calefacción en sombra. La sección de comunicaciones añade un presupuesto RF editable; el volumen de datos sigue siendo una hipótesis de contacto continuo cuando la Tierra es visible, no una agenda DSN confirmada. El visor 3D permite descargar un diagnóstico local de FPS y carga para pruebas en teléfonos físicos. El protocolo está en [`docs/PREPARACION_PUBLICA.md`](../docs/PREPARACION_PUBLICA.md).

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
- Evaluación preliminar de **pendiente regional LOLA** (`240 m/px`, escalas `240 m`, `480 m` y `960 m`) con umbral de referencia configurable por el usuario, estadísticas de vecindario circular y descargo explícito: `10°` no es un umbral universal de aterrizaje (los límites dependen del vehículo y de la escala de medición, véase [NASA OIG IG-26-004](https://oig.nasa.gov/wp-content/uploads/2026/03/final-report-ig-26-004-nasas-management-of-the-human-landing-system-contracts.pdf)) y ningún punto se etiqueta como «aterrizaje seguro».
- Modo Analyst con umbrales ajustables.
- Comparación de dos sitios (incluyendo pendiente regional y P90 a 2 km) y exportación CSV del escenario principal con coordenadas, fuentes, paso temporal y amplitud del intervalo de incertidumbre de transición.
- Visor 3D con malla local LOLA de 240 m (9,6 km) o 20 m (2 km) donde hay cobertura. Su textura WAC estática se alinea con la malla en coordenadas polares; mide 480 m/píxel y por tanto no añade detalle local. Los modelos [Luna](public/luna/luna_cientifica.glb), [Sol](public/sol/sol_cientifico.glb) y [Tierra](public/tierra/tierra_cientifica.glb) del equipo se sitúan en una vista global con direcciones aparentes del escenario; tamaños y distancias son ilustrativos. El dibujo se limita a un cuadro por ciclo de pantalla y usa una resolución de render acotada para mejorar la interacción. El sombreado 3D no sustituye los cálculos de visibilidad.
- Guía de tres pasos en pantalla: elegir sitio, cambiar la hora y explorar el 3D. Los botones Luna, Sol y Tierra enfocan el modelo y explican ubicación, luz y enlace con las elevaciones y horizontes calculados para la muestra seleccionada. Un indicador animado muestra los tres GLB durante la espera de la API; su secuencia es visual y no representa un porcentaje de avance de Horizons.
- Enlace al globo 3D del portal NASA Moon Trek. Moon Trek ofrece visualización 3D y análisis propios, mientras su [API pública documentada](https://trek.nasa.gov/tiles/apidoc/) publica capas WMTS de imágenes 2D. El visor local usa DEM LOLA y efemérides de Horizons para conservar el cálculo reproducible, y el portal sirve para exploración externa. El enlace no lleva de manera verificada al mismo sitio y hora.
- Diseño adaptable para escritorio y móvil.

Quedan pendientes la validación de ubicaciones exactas de aterrizaje, una referencia topográfica independiente de LOLA y la validación externa de ventanas completas de visibilidad. Ya se compararon los DEM LOLA de 20 y 240 m; las pruebas y sus límites figuran en [validación científica](../docs/VALIDACION_CIENTIFICA.md). La proyección polar sur publicada por NASA Moon Trek para el mosaico WAC es `IAU2000::30120` según su [configuración oficial](https://trek.nasa.gov/tiles/apidoc/config/config.json). La foto WAC no muestra las sombras de la fecha elegida y, remuestreada a 480 m/píxel en el recorte incluido, tampoco permite identificar rocas pequeñas ni peligros locales. El DEM LOLA de 240 m/píxel solo sirve como evaluación regional preliminar y no certifica una zona de contacto segura.
