# Preparación para uso público

## Datos y arranque

Antes de cada despliegue, desde `backend`:

```powershell
.venv\Scripts\python scripts/download_lola.py --highres
.venv\Scripts\python -m pip install -e '.[validation]'
.venv\Scripts\python scripts/validate_nac_stereo.py
.venv\Scripts\python scripts/verify_assets.py --strict
.venv\Scripts\python -m pytest -q
```

`verify_assets.py` valida estructura, tamaño, etiquetas y georreferencia de los productos instalados; registra hashes SHA-256 para comparar despliegues. Sale con código distinto de cero si `required_ok: false`, por lo que debe formar parte de la puerta de publicación. `GET /api/v1/data/availability` informa presencia local del DEM de 240 m, el de 20 m y los DTM NAC; **no** afirma que Horizons o Moon Trek estén disponibles en ese instante. Las peticiones externas fallan de manera explícita. El catálogo y las imágenes WAC de base están en el frontend; los raster científicos de mayor tamaño requieren volumen persistente en el servidor. No se publican números científicos de sustitución al fallar una consulta.

Para evitar que una caché de desarrollo se incluya accidentalmente en una entrega, la base SQLite y los raster descargados deben estar en almacenamiento persistente del despliegue. La instancia pública necesita límites de concurrencia, observabilidad de tiempos/error por endpoint y un plan de restauración de datos; estas tareas pertenecen al entorno de hospedaje.

## Prueba en teléfono físico

El visor muestra FPS observados durante interacción, tiempo de carga del modelo, triángulos y memoria JS si el navegador la expone. Tras arrastrar el modelo al menos 20 segundos en cada modo (`Automática`, `Alta`, `Ahorro`), el participante puede pulsar **Descargar diagnóstico 3D**. El JSON queda en el dispositivo; la app no lo transmite. Repetir con Luna/Sol/Tierra y con terreno local en al menos un teléfono Android y un iPhone de gamas diferentes, con red Wi-Fi y móvil, registrando versión del navegador y presencia de WebGL. Medir también tiempo hasta primer resultado y errores de API. La emulación de viewport en escritorio no sustituye esta prueba.

## Prueba de comprensión con personas

Invitar a personas que no hayan usado la aplicación. Darles la problemática, sin explicar los controles, y pedirles: (1) elegir dos lugares y una fecha, (2) identificar una ventana de Sol y otra de comunicación, (3) explicar por qué el relieve bloquea un cuerpo, (4) reconocer cuándo no hay NAC local, (5) decir si el sistema certifica un aterrizaje o un enlace de radio. Registrar éxito, tiempo, errores de interpretación y frases confusas; no recopilar datos personales. Corregir los problemas observados y repetir con otras personas. Ninguna prueba con participantes ni con teléfonos físicos se ha ejecutado en esta estación.

## Límites de evidencia

- El DTM NAC de 2 m permite medir un plano y rugosidad residual en una huella configurada solo donde hay cobertura. No detecta todas las rocas ni propiedades del suelo; no declara seguridad de aterrizaje.
- El presupuesto de enlace usa entradas de EIRP, G/T, distancia, frecuencia y pérdidas configuradas por el usuario. La simulación de datos supone tasa nominal y contacto continuo cuando el centro de la Tierra supera el despeje configurado; no incluye la ubicación ni agenda real de estación, clima, apuntamiento ni certificación RF. La porción visible del disco terrestre no se convierte artificialmente en tasa de datos.
- Los perfiles de energía son ejemplos. El factor de pérdidas, calefacción en sombra y eficiencia de batería son configurables; faltan ensayos térmicos y eléctricos del vehículo concreto.
- La banda de sensibilidad vertical del DEM no es un intervalo de confianza calibrado. La comparación NAC independiente no cubre los casos de 240 m a la frecuencia nominal de `3σ`; véase [validación científica](VALIDACION_CIENTIFICA.md).
