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

El repositorio aún no contiene un backend. La interfaz usa **datos de demostración ilustrativos** y los identifica de forma visible. Las coordenadas de los puntos, el mapa, el relieve y los resultados de esta demo no están validados para planificación de misiones.

Por defecto se utiliza la demo. Para activar el backend, configura `VITE_USE_API=true` según `.env.example`. Entonces el cliente intenta `POST /api/scenarios/analyze`; si no hay servicio o la respuesta es inválida, usa la demo. En desarrollo, Vite redirige `/api` a `http://localhost:8000`. Para otro destino, configura `VITE_API_BASE_URL`.

Solicitud esperada:

```json
{
  "latitude": -85.4,
  "longitude": -29.2,
  "start_time": "2026-11-15T00:00:00Z",
  "hours": 168,
  "step_minutes": 60
}
```

Respuesta esperada:

```json
{
  "samples": [
    {
      "hour": 0,
      "sun_elevation": 2.1,
      "earth_elevation": 4.7,
      "horizon_sun": 1.8,
      "horizon_earth": 2.2,
      "sun_visible": true,
      "earth_visible": true
    }
  ]
}
```

Se esperan al menos dos muestras horarias. La API debe proporcionar sus propios cálculos de efemérides y horizonte topográfico; el frontend no los calcula. La vista de horizonte sigue siendo una ilustración visual, incluso cuando las métricas provienen de la API.

## Alcance actual

- Selección entre cuatro regiones de muestra y fecha UTC.
- Visibilidad solar y terrestre, intervalos de oscuridad y blackout, gráfico temporal y control de hora.
- Modo Analyst con umbrales ajustables.
- Comparación de dos sitios y exportación CSV del escenario principal.
- Diseño adaptable para escritorio y móvil.

El mapa científico con proyección polar, datos LOLA/LRO, vista 3D y copiloto IA requieren los servicios y datasets del plan original; no se presentan como funciones científicas de esta versión.
