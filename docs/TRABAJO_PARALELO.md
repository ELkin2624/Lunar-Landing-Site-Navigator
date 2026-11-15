# Próximo trabajo en paralelo

Estado al 15 de noviembre de 2026: la interfaz ya consume la API por defecto y no sustituye errores por métricas simuladas. El análisis operativo usa Horizons y LOLA de 240 m. Hay un DEM LOLA de 20 m para la malla 3D desde 87,5° S hasta el polo. Los informes reproducibles están en `VALIDACION_CIENTIFICA.md` y los JSON del mismo directorio.

## Backend: prioridad científica

1. **Horizonte multirresolución.** Integrar el DEM de 20 m en los primeros kilómetros del trazado cuando la cobertura sea completa; usar 240 m para montañas lejanas. Asegurar la misma altura del observador y devolver por azimut la fuente y distancia del obstáculo dominante. Validar ventanas y métricas antes/después con varios sitios y fechas.
2. **Incertidumbre espacial.** Perturbar la coordenada dentro de una vecindad definida y medir rangos de visibilidad, pendientes y horizontes; exponer incertidumbre por sitio en la API y CSV. La diferencia de hasta 11,12° en el horizonte local de la muestra de Gerlache justifica este paso.
3. **Validación de ventanas completas.** Contrastar eventos y fracciones de luz/comunicación contra cálculos independientes, no solo posiciones puntuales. Registrar kernel, DEM, fecha de producto, datum, paso temporal y método de interpolación.
4. **Recursos de misión.** Vincular ventanas de luz y enlace con batería, carga eléctrica y capacidad de comunicación configurables por vehículo; mantener la distinción entre evaluación preliminar y decisión de aterrizaje.

## Frontend: prioridad de uso

1. **Mapa local continuo.** Añadir paneo libre, escala gráfica, coordenadas bajo el cursor y leyenda de cobertura. Mantener las capas WAC/NAC/LOLA georreferenciadas y no presentar la foto como sombra de la fecha seleccionada.
   Reexaminar el enlace compartido de Moon Trek con un caso que el propio portal genere y abra en una sesión limpia; el enlace sintetizado para de Gerlache restableció centro y zoom, de modo que el botón actual abre el portal sin prometer centrado.
2. **Relieve 3D detallado.** Conseguir una textura local NAC georreferenciada y comprobar su cobertura y licencia. Mostrar resolución real de DEM y textura por separado. Ofrecer calidad de render adaptable y medir FPS en dispositivos modestos.
3. **Explicación de resultados.** Mostrar la diferencia entre elevación de Sol/Tierra y horizonte en el azimut correspondiente, identificar el obstáculo dominante y exponer el intervalo temporal de incertidumbre de cada transición.
4. **Comparación con incertidumbre.** Añadir rangos, cobertura y procedencia a las tablas y exportaciones; evitar un ganador único cuando las diferencias estén dentro del error estimado.

## Contratos entre ambos equipos

- El backend añade campos opcionales y versionados a `/api/v1`, manteniendo el adaptador actual durante la migración.
- El frontend muestra `sin cobertura` o `no evaluado` cuando falten DEM, efemérides o metadatos; nunca calcula resultados de reserva.
- Los dos equipos acuerdan unidades (`m`, `km`, grados), marco lunar `MOON_ME`, proyección polar, intervalos UTC `[inicio, fin)` y fuente de cada valor antes de cambiar las pantallas.
