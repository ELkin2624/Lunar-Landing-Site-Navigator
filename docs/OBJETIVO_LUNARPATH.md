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
| NASA PDS LOLA | Elevación, perfil topográfico del horizonte y pendiente regional multiescala | DEM de 20 m cerca del polo donde hay cobertura y 240 m para obstáculos lejanos; evaluación regional |
| LROC NAC estéreo PDS | Relieve local independiente para validar LOLA y medir una huella | Dos DTM de 2 m integrados con cobertura limitada; pendiente y rugosidad sin certificación de seguridad |
| NASA Moon Trek | Cartografía georreferenciada y capas polares (`IAU2000::30120`) | WAC polar incluido; zoom consulta NAC y relieve LOLA de 5 m donde hay cobertura. La foto no muestra sombras de la fecha elegida |
| Blender | Luna y escenas 3D para exploración y explicación | `luna_cientifica.glb` integrado en visor; no es fuente de elevación científica |

Horizons, LOLA y Moon Trek son recursos diferentes. El modelo de Blender es una representación visual. Los cálculos de visibilidad deben continuar usando efemérides y topografía georreferenciada.

## Estado comprobado en el repositorio

- Backend FastAPI con contratos Pydantic, Horizons, caché SQLite, catálogo de sitios, horizonte LOLA mixto, pendiente regional, evaluación local NAC, malla 3D, línea temporal, comparación, ranking, Mission Delta, energía configurable, presupuesto RF condicional y CSV con procedencia y banda de sensibilidad.
- Frontend React/TypeScript con explorador y comparación conectados a la API, capas LOLA/LROC WAC y teselas locales NAC/LOLA de Moon Trek, selección de coordenadas, panel de pendiente regional, perfil local LOLA y visor 3D con el globo Blender del equipo y malla local del DEM.
- Los resultados actuales son estimaciones para planificación y educación. La visibilidad directa de la Tierra no certifica un enlace de radio, el presupuesto RF requiere parámetros y agenda de estación reales, la simulación eléctrica no certifica el vehículo y ni la pendiente regional LOLA ni la huella NAC de 2 m constituyen evaluación completa de seguridad. Los límites dependen del vehículo y de la escala de medición; véase [NASA OIG IG-26-004](https://oig.nasa.gov/wp-content/uploads/2026/03/final-report-ig-26-004-nasas-management-of-the-human-landing-system-contracts.pdf).

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

1. **Coherencia temporal y validación científica.** Completadas pruebas de sensibilidad 60/15/5 min, LOLA 20/240 m, DTMs NAC independientes, órbita INPOP19a y orientación lunar alternativa; la matriz estacional abarca cinco sitios y cuatro fechas. La banda vertical de 240 m no está calibrada como confianza estadística. Faltan más DTMs, lugares y contrastes operativos.
2. **Integración frontend–backend.** Sitios de muestra, punto personalizado, horizonte, pendiente y terreno 3D conectados. Las exportaciones conservan procedencia, resolución y amplitud del intervalo de transición.
3. **Cartografía.** WAC y LOLA polares, zoom con NAC/LOLA local y avisos de ausencia de cobertura integrados. El portal Moon Trek se abre desde la tarjeta del sitio; el enlace profundo generado no conservó centro ni zoom en una prueba de apertura y se retiró. Falta navegación libre del centro.
4. **Visualización Blender.** GLB de Luna, Sol y Tierra integrados con direcciones aparentes de Horizons. Modelos LOD y textura NAC local donde hay cobertura; telemetría FPS descargable. Falta medir teléfonos físicos.
5. **Evaluación de misión y presentación.** Huella NAC, energía con pérdidas y calefacción, y presupuesto RF con parámetros editables integrados. Faltan ensayos específicos de vehículo, agenda real de estación, evaluación de rocas/suelo y prueba de comprensión con personas.

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
