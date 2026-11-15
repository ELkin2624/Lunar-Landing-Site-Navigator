# Estado del trabajo en paralelo

Actualizado tras completar la integración técnica, validación estéreo LROC NAC y propagación estadística DEM:

## Completado

- **Pendiente regional 20 m/px + 240 m/px (`slope.py` / `main.py` / `RegionalSlopeCard`)**: `/api/v1/terrain/slope` usa `LDEM_875S_20M` (20 m/px) para `lat <= -87.5°` cuando hay cobertura, con fallback automático a 240 m/px y escalas adaptativas en UI.
- **Ventana y muestreo configurables + refinamiento a 5 min (`App.tsx` / `api.ts` / `main.py`)**: la consola permite elegir duración (24 h, 72 h, 168 h, 336 h), paso base (60 / 30 / 15 min) y refinamiento de transiciones a 5 min (±2,5 min), manteniendo sincronizados Horizonte, Línea de tiempo, Batería y 3D.
- **Máscara fina de cobertura NAC y caché en disco (`nac_texture.py` / `LocalTileMap.tsx`)**: detección por canal alfa de píxeles válidos no-data y caché local en disco para texturas NAC, más estado explícito de modo offline y proporción de teselas en el mapa 2D.
- **Copiloto Q&A y CSV desde backend (`copilot.py` / `App.tsx`)**: caja de preguntas abiertas conectada a `POST /api/v1/copilot/ask` y exportación CSV directa desde `POST /api/v1/scenarios/export/csv`.
- **Optimización de modelos 3D GLB y telemetría de rendimiento (`build_lod_glb.py`, `OrbitalLoading.tsx`, `Terrain3D.tsx`, `vite.config.ts`)**: variantes LOD (`*_lod.glb`, ~548 KB combinados vs 30,3 MB originales) usadas en carga inicial y modos `Auto`/`Ahorro`, reservando los modelos completos para `Alta`; chunk dedicado para `three` y medición en vivo de FPS, tiempo de carga (ms), triángulos y memoria JS heap.
- **Incertidumbre espacial + propagación estadística formal del DEM 3σ (`terrain.py`, `main.py`)**: recomputación paralela de efemérides JPL Horizons + horizontes locales en 5 puntos y envolventes ±3σ basadas en el RMSE vertical empírico de LOLA (`2,7 m` en 20 m/px, `18,0 m` en 240 m/px), expuestas en API, UI y CSV.
- **Validación independiente con DEM estéreo LROC NAC y orientación `IAU_MOON` (`scripts/validate_nac_stereo.py`, `scripts/validate_independent.py`)**: contraste real contra `NAC_DTM_ESALL_CR1` y `NAC_DTM_ESALL_MP1` (2 m/px de PDS4) y contraste de transiciones cada 5 min frente a `INPOP19a` + `pck00011.tpc` (`VALIDACION_STEREO_NAC.json` y `VALIDACION_INDEPENDIENTE.json`).

## Pendiente únicamente por dependencia de hardware externo

- **Telemetría en teléfonos físicos reales (`adb devices` vacío en esta estación)**: la estación actual no tiene dispositivos móviles físicos conectados para medir GPU móvil real y red celular; las pruebas de viewport móvil se ejecutaron en navegador de escritorio emulado.
