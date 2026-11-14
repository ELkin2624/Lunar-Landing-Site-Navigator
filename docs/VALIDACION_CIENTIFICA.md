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
- Estas verificaciones comprueban consistencia interna y sensibilidad temporal. Aún falta una comparación orbital independiente y una evaluación de sensibilidad a DEM de mayor resolución; no constituyen validación para navegación o selección final de aterrizaje.
