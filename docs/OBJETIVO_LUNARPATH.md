# Objetivo del proyecto: LunarPath AI

## Problema y propuesta

Las misiones al polo sur lunar necesitan comparar rápidamente sitios y fechas bajo restricciones de iluminación, energía y comunicación directa con la Tierra. LunarPath AI será una aplicación web que permita configurar una misión, explorar regiones lunares, analizar escenarios con datos científicos y entender visualmente por qué un sitio o una fecha resulta más conveniente.

La experiencia combinará la propuesta educativa y de exploración 3D del equipo con el motor científico que ya existe en este repositorio. El recorrido principal será:

1. Definir fecha, duración y requisitos de la misión.
2. Explorar la Luna y seleccionar dos o tres sitios o coordenadas.
3. Calcular Sol, Tierra y horizonte local para cada escenario.
4. Comparar ventanas de iluminación y comunicación, energía estimada y restricciones.
5. Mostrar las condiciones en una vista de superficie sincronizada con la línea temporal.
6. Explicar los resultados y exportarlos con fuente, resolución y limitaciones.

## Fuentes y funciones

| Recurso | Función | Estado |
| --- | --- | --- |
| JPL Horizons | Efemérides topocéntricas del Sol y la Tierra | Integrado en FastAPI |
| NASA PDS LOLA | Elevación, perfil topográfico del horizonte y pendiente regional multiescala | DEM `LDEM_75S_240M` (240 m/píxel) integrado para horizonte y pendiente regional preliminar |
| NASA Moon Trek | Cartografía georreferenciada y capas polares (`IAU2000::30120`) | WAC polar incluido; zoom consulta NAC y relieve LOLA de 5 m donde hay cobertura. La foto no muestra sombras de la fecha elegida |
| Blender | Luna y escenas 3D para exploración y explicación | `luna_cientifica.glb` integrado en visor; no es fuente de elevación científica |

Horizons, LOLA y Moon Trek son recursos diferentes. El modelo de Blender es una representación visual. Los cálculos de visibilidad deben continuar usando efemérides y topografía georreferenciada.

## Estado comprobado en el repositorio

- Backend FastAPI con contratos Pydantic, consulta a Horizons, caché SQLite, catálogo de sitios, horizonte LOLA, pendiente regional multiescala, malla de terreno para visualización 3D (`/api/v1/terrain/mesh`), línea temporal, comparación, ranking, Mission Delta, energía preliminar y exportación CSV con procedencia e incertidumbre temporal.
- Frontend React/TypeScript con explorador y comparación conectados a la API, capas LOLA/LROC WAC y teselas locales NAC/LOLA de Moon Trek, selección de coordenadas, panel de pendiente regional, perfil local LOLA y visor 3D con el globo Blender del equipo y malla local del DEM.
- Los resultados científicos actuales son estimaciones para planificación y educación. La visibilidad directa de la Tierra no certifica un enlace de radio, la simulación eléctrica no certifica el sistema de energía y una pendiente calculada con el DEM de 240 m/píxel solo sirve como evaluación regional preliminar (`10°` no es un umbral universal de aterrizaje; los límites dependen del vehículo y de cómo se mida la pendiente, véase [NASA OIG IG-26-004](https://oig.nasa.gov/wp-content/uploads/2026/03/final-report-ig-26-004-nasas-management-of-the-human-landing-system-contracts.pdf)).

## Contrato del producto

- Una fuente de verdad temporal: intervalos `[inicio, fin)` determinan línea temporal, métricas, restricciones, ranking y exportación.
- Cada resultado declara sitio, fechas UTC, fuente de efemérides, fuente y resolución del relieve, paso temporal y rango de incertidumbre de los cambios.
- Se distinguen estados visibles y bloqueados. Si falta información necesaria, el estado debe ser desconocido y no contarse como visible ni como bloqueado.
- La interfaz presenta métricas solo cuando responde la API científica; los errores se muestran sin sustituir resultados por simulaciones.
- Las coordenadas de regiones candidatas no se presentan como puntos de aterrizaje aprobados.
- El visor 3D recibe coordenadas, hora, orientación y resultados desde la API; su geometría no altera el resultado científico.

## Entrega prioritaria

**Demostración vertical:** seleccionar una región en el explorador, elegir fecha y duración, consultar FastAPI, visualizar Sol y Tierra respecto al horizonte, comparar al menos dos escenarios y explicar la recomendación. La exportación debe conservar fuentes y límites del análisis.

### Orden de implementación

1. **Coherencia temporal y validación científica.** Exploración densa e informes reproducibles de sensibilidad 60/15/5 min, degradación 480/960 m y comparación con el producto LOLA de 20 m. Un contraste con NAIF SPICE y la órbita independiente INPOP19a verifica seis posiciones. Falta una orientación lunar y topografía independientes, además de validación de ventanas completas.
2. **Integración frontend–backend.** Sitios de muestra, punto personalizado, horizonte, pendiente y terreno 3D conectados. Las exportaciones conservan procedencia, resolución y amplitud del intervalo de transición.
3. **Cartografía.** WAC y LOLA polares, zoom con NAC/LOLA local y avisos de ausencia de cobertura integrados. El portal Moon Trek se abre desde la tarjeta del sitio; el enlace profundo generado no conservó centro ni zoom en una prueba de apertura y se retiró. Falta navegación libre del centro.
4. **Visualización Blender.** GLB de Luna, Sol y Tierra integrados con direcciones aparentes de Horizons. La malla local usa 20 m donde hay cobertura y 240 m en el resto, con textura WAC alineada pero de baja resolución. Falta optimizar los GLB y añadir una textura local de mayor resolución con licencia y cobertura verificadas.
5. **Evaluación de misión y presentación.** Pendiente regional, luz y enlace explicados como criterios separados; falta ampliar requisitos específicos por vehículo, energía y comunicaciones y preparar narrativa de demostración.

### Criterios de aceptación de la demostración

- Dos sitios y una fecha producen resultados reales de Horizons y una comparación reproducible.
- Los valores de la línea temporal y las métricas coinciden con los mismos intervalos.
- El usuario puede ver cuándo y por qué un relieve bloquea el Sol o la Tierra.
- La vista 3D se sincroniza con los datos calculados y se identifica como visualización.
- Los errores de red, cobertura del DEM y datos ausentes se muestran sin convertirlos en resultados favorables.
- La presentación distingue precisión regional, aproximaciones de energía y trabajo futuro.

## Referencias de planificación

- Conversación del proyecto: [Propuesta LunarPath AI](https://chatgpt.com/c/6af8b4ab-2efc-83e9-8927-079608dc712f).
- Síntesis aportada por el equipo: `Texto colado.txt` adjunto a la conversación de trabajo.
- Documentación técnica local: [`backend/README.md`](../backend/README.md).
