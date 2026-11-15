# Validación inicial del motor científico

## Alcance

El script `backend/scripts/validate_science.py` consulta JPL Horizons y el DEM LOLA local. Verifica que los segmentos temporales cubran exactamente el periodo sin huecos, que las ventanas sumen los porcentajes reportados y que las fracciones estén dentro de `[0, 1]`. Compara además el mismo escenario con pasos de 60, 15 y 5 minutos. Se ejecuta con:

```powershell
cd backend
.venv\Scripts\python scripts/validate_science.py
```

## Resultado observado

Para el ejemplo geométrico de latitud 0°, longitud 0°, entre el 16 y el 18 de noviembre de 2026 (UTC):

| Paso | Muestras | Fracción con Sol visible | Oscuridad continua máxima |
| --- | ---: | ---: | ---: |
| 60 min | 48 | 47,9167 % | 25 h |
| 15 min | 192 | 49,7396 % | 24,125 h |
| 5 min | 576 | 49,7396 % | 24,125 h |

El cálculo horario difiere 1,823 puntos porcentuales del de 5 minutos en esta ventana. El acuerdo de 15 y 5 minutos es una comprobación de sensibilidad para **este caso**, no una garantía universal. Una segunda consulta con el DEM LOLA en 89,5° S y 0° E leyó una altura de observador de −0,703 km respecto a la esfera de referencia y superó las mismas invariantes temporales.

## Límites

- La detección densa sigue siendo discreta: puede omitir eventos completos más breves que el paso elegido.
- El instante reportado es el punto medio entre la última muestra de un estado y la primera del siguiente. El intervalo completo se conserva como incertidumbre.
- LOLA de 240 m/píxel sirve para comparación regional, pero no resuelve todos los obstáculos locales.
- Estas verificaciones comprueban consistencia interna y sensibilidad temporal. El contraste con el DEM de 20 m y la órbita independiente INPOP19a se documenta abajo. Aún faltan una referencia topográfica independiente, una orientación lunar independiente y validación de las ventanas completas. No constituyen validación para navegación o selección final de aterrizaje.

## Sensibilidad temporal y espacial reproducible

`backend/scripts/validate_resolution.py` guarda el informe numérico en `docs/VALIDACION_RESOLUCION.json`. Para la referencia geométrica ecuatorial del 16 al 18 de noviembre de 2026, el paso de 60 minutos dio 47,9167 % de tiempo con Sol y el de 5 minutos 49,7396 %: diferencia de **1,823 puntos porcentuales**. Los pasos de 15 y 5 minutos coincidieron en este caso. Los intervalos de los eventos siguen limitados por el paso elegido.

En el punto de muestra de Malapert (86° S, 3,8° E), durante 24 horas desde el 15 de noviembre de 2026, el análisis de 60, 15 y 5 minutos dio luz y visibilidad terrestre continuas. Eso solo indica que **este periodo no contiene un cambio sensible al paso**. Para cuantificar el efecto de resolución espacial se calculó el horizonte a 50 km en azimuts cada 5° con el DEM original de 240 m y con copias promediadas a 480 y 960 m. Frente a 240 m, el error absoluto medio del horizonte fue **1,70°** y **6,33°**; el percentil 90 fue **2,94°** y **11,29°**, respectivamente. En esas 24 horas no cambió la clasificación del centro del Sol o de la Tierra, aunque el horizonte sí cambió sustancialmente.

Los DEM de 480 y 960 m se derivan del mismo producto LOLA; **no** son una referencia independiente ni sustituyen un DEM de 20 m. La resolución vertical, el registro horizontal, la cobertura y los obstáculos menores de 20 m siguen sin validación. La vista 3D y las capas Moon Trek son visualizaciones y no cambian estos cálculos.

## Contraste con LOLA de 20 m y NAIF SPICE

El producto PDS `LDEM_875S_20M` (20 m/píxel, 87,5°–90° S) se descargó junto con su etiqueta PDS. [`VALIDACION_DEM_20M.json`](VALIDACION_DEM_20M.json) compara cota puntual, pendiente de Horn con base comparable de ~240 m y horizonte hasta 5 km cada 5° en tres sitios cubiertos. La diferencia absoluta de cota fue de 10 a 28,5 m; la diferencia absoluta media del horizonte fue de 1,24°, 4,43° y 11,12° según el sitio. La diferencia de 11,12° en de Gerlache muestra que **el resultado regional de 240 m puede ser muy sensible al relieve cercano**. Las dos mallas son productos LOLA, por lo que esto mide sensibilidad a resolución e interpolación y no es una validación independiente del terreno. El análisis operativo ahora usa 20 m en los primeros 5 km donde hay cobertura y 240 m después; fuera de la cobertura fina conserva 240 m. El perfil devuelve distancia y fuente del obstáculo dominante por azimut.

[`VALIDACION_SPICE.json`](VALIDACION_SPICE.json) compara seis casos (Sol y Tierra en tres sitios y fechas) entre JPL Horizons y una proyección este–norte–arriba calculada con NAIF SPICE (`MOON_ME`, aberración `LT+S`). Con el kernel DE440 la mayor diferencia de azimut fue 0,00000081° y la de elevación 0,000027°. Al sustituir la **órbita** por [INPOP19a de IMCCE alojada por ESA](https://spiftp.esac.esa.int/data/SPICE/JUICE/kernels/spk/), las diferencias máximas fueron 0,00000123° y 0,000027° en estos casos. La solución orbital INPOP19a es independiente de JPL; la orientación lunar sigue usando el PCK DE440, de modo que la prueba no es totalmente independiente. Tampoco valida las ventanas de visibilidad con topografía.

## Ventanas completas y sensibilidad local

[`VALIDACION_VENTANAS_SPICE.json`](VALIDACION_VENTANAS_SPICE.json) contrasta todas las ventanas muestreadas de Sol y Tierra en dos sitios, siete días cada uno, con pasos de 30 minutos. Las posiciones de Horizons y de la órbita INPOP19a dieron **cero discrepancias de clasificación** y las mismas ventanas en esa cuadrícula. La orientación lunar y el perfil LOLA son compartidos; eventos enteramente entre muestras, errores del DEM y la independencia de la orientación siguen fuera del alcance.

El mismo informe compara el horizonte mixto con el de 240 m. En Mons Mouton no cambió ninguna de las 336 muestras por cuerpo. En la muestra de de Gerlache cambiaron **40 muestras solares** y **1 terrestre**; la fracción solar pasó de 9,52 % con 240 m a 21,43 % con el horizonte mixto en esa semana. El cambio indica sensibilidad fuerte al relieve local, no que la cifra fina esté certificada. La frontera de cobertura y el registro horizontal del DEM requieren análisis adicional.

La API permite pedir un radio de sensibilidad espacial (el adaptador del frontend usa 240 m): evalúa el centro y hasta cuatro posiciones cardinales recomputando efemérides Horizons y perfiles LOLA locales para cada coordenada vecina. Añade una **banda de sensibilidad condicional**, calculada al multiplicar por `landing_dispersion_sigma` (por defecto `3.0`) la propagación del error vertical supuesto del DEM (`dem_vertical_sigma_m`). Cada azimut modela la covarianza espacial mediante variograma gaussiano ($\rho(d) = \exp(-(d/L_c)^2)$, con $L_c = 400\text{ m}$ en LOLA `20 m/px` y $1500\text{ m}$ en `240 m/px`) para propagar $\sigma_\theta = \arctan(\sqrt{\sigma_{z,\text{obs}}^2 + \sigma_{z,\text{ter}}^2 - 2\rho\sigma_{z,\text{obs}}\sigma_{z,\text{ter}}}/d)$ usando el RMSE empírico frente a NAC (`2,7 m` en `20 m/px` y `18,0 m` en `240 m/px`). Esta banda **no es un intervalo de confianza calibrado**: el RMSE de cota no incluye todo el error de representación de obstáculos. El CSV exportado por `/api/v1/scenarios/export/csv` incluye `dem_vertical_sigma_m`, `landing_dispersion_sigma`, `horizon_envelope_deg`, ambos productos DEM, `fine_coverage_km`, `sun_disk_fraction` y `earth_disk_fraction`.

## Validación topográfica con DEM estéreo independiente (LROC NAC)

[`VALIDACION_STEREO_NAC.json`](VALIDACION_STEREO_NAC.json) (generado por `backend/scripts/validate_nac_stereo.py` e integrado en [`VALIDACION_INDEPENDIENTE.json`](VALIDACION_INDEPENDIENTE.json)) compara `LDEM_875S_20M` (20 m/px) y `LDEM_75S_240M` (240 m/px) contra dos DTMs estéreo independientes de **LROC NAC a 2,0 m/px** descargados de NASA PDS (`LRO-L-LROC-5-RDR`):

| Producto NAC (2 m/px) | Referencia LOLA | Sesgo medio (NAC − LOLA) | RMSE vertical | P95 abs. | Desfase horiz. mínimo (`dx, dy`) | Dif. horizonte 2 km |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| `NAC_DTM_ESALL_CR1` (Connecting Ridge) | LOLA 20 m (`4001` pts) | `+1,110 m` | **`2,674 m`** | `5,560 m` | `(0 m, 0 m)` en paso ±10 m | **`0,248°`** (P95 `0,509°`) |
| `NAC_DTM_ESALL_CR1` (Connecting Ridge) | LOLA 240 m (`4001` pts) | `+1,993 m` | `16,988 m` | `35,500 m` | `(0 m, 0 m)` en paso ±60 m | `2,796°` |
| `NAC_DTM_ESALL_MP1` (Mons Malapert) | LOLA 240 m (`4003` pts) | `+1,133 m` | `18,944 m` | `36,258 m` | `(0 m, 0 m)` en paso ±60 m | `4,589°` |

En la frontera de cobertura de la malla fina (`-87,52°`, `-87,6°` y `-88,0° S`, `216` muestras), `LOLA 20 m − LOLA 240 m` presentó un sesgo de `-0,593 m`, RMSE de `15,575 m` y P95 de `29,0 m`.

## Validación de transiciones cada 5 min con orientación lunar independiente

[`VALIDACION_INDEPENDIENTE.json`](VALIDACION_INDEPENDIENTE.json) (generado por `backend/scripts/validate_independent.py`) extiende la validación a una malla de **5 minutos** (2.016 muestras por astro en 7 días, del 15 al 22 de febrero de 2027 UTC) en **de Gerlache Rim 2** (−88,3° S, −59,5° E) y **Mons Mouton** (−84,6° S, 31,0° E), usando dos modelos independientes respecto a JPL Horizons:

1. **Órbita independiente + orientación DE440 (`INPOP19a` + `MOON_ME`)**: **0 discrepancias** de clasificación sobre las 8.064 muestras totales (diferencia máxima de elevación ≤ 0,000027°).
2. **Órbita independiente + orientación analítica NAIF (`INPOP19a` + `IAU_MOON` de `pck00011.tpc`)**: diferencia angular máxima de **0,0022°** en azimut y **0,0018°** en elevación frente a Horizons; exactamente el mismo número de transiciones detectadas (5 solares y 1 terrestre en de Gerlache; 1 solar y 1 terrestre en Mons Mouton), con un desplazamiento máximo de **1 paso (5,0 min)** en solo 1 muestra rasante de Sol en de Gerlache y 1 muestra rasante de Tierra en Mons Mouton.

Las dos validaciones independientes (transiciones a 5 min con orientación `IAU_MOON` + órbita `INPOP19a`, y elevación/registro/horizonte contra DTMs estéreo `LROC NAC` de 2 m/px) quedan integradas y reproducibles en `VALIDACION_INDEPENDIENTE.json` y `VALIDACION_STEREO_NAC.json`.

## Auditoría ampliada de estaciones, cobertura y banda vertical

[`VALIDACION_ESTACIONAL.json`](VALIDACION_ESTACIONAL.json), generada por `backend/scripts/validate_seasons.py`, contiene **40 casos**: cinco sitios (incluido un punto a 87,51° S junto al límite del DEM fino), cuatro fechas próximas a equinoccios/solsticios de 2027 y Sol/Tierra durante siete días a paso horario. Compara horizonte mixto 20/240 m frente a 240 m y orientación `MOON_ME` frente a `IAU_MOON` con órbita `INPOP19a`. Hubo **126 clasificaciones distintas por la resolución del relieve**, **0 por la orientación** y **622 muestras dentro de la banda vertical supuesta**. La prueba utiliza horizonte cada 10° e intervalos horarios para poder auditar la matriz completa; eventos más breves pueden faltar. Los sondeos de cobertura registran presencia de LOLA fino a 87,51° S, ausencia a 87,49° S y límite general de LOLA a 75° S.

Al añadir a la comparación NAC independiente una comprobación azimutal de la banda vertical de `3σ`, el DTM NAC quedó dentro de la banda en **36/36 azimuts** con LOLA 20 m en Connecting Ridge, **24/36** con LOLA 240 m allí y **16/36** con LOLA 240 m en Mons Malapert. Esos dos últimos resultados muestran que el margen no está calibrado para cobertura nominal de 99,7% ni para todas las regiones. La API y el CSV declaran `confidence_calibrated=false`; conservan la banda para explorar sensibilidad, pero la interfaz ya no la presenta como confianza estadística. La validación de peligros por rocas, ensayos de comunicaciones y desempeño térmico/eléctrico de vehículos sigue fuera del alcance de estos datos.
