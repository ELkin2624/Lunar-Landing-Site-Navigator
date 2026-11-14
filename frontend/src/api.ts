import { makeDemoScenario, type Scenario, type Site, type Sample } from './data'

const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const useApi = import.meta.env.VITE_USE_API === 'true'

/**
 * Contrato esperado: POST /api/scenarios/analyze con {latitude, longitude,
 * start_time, hours, step_minutes}. Respuesta: {samples:[{hour,
 * sun_elevation, earth_elevation, horizon_sun, horizon_earth,
 * sun_visible, earth_visible}]}. La demo solo se usa cuando VITE_USE_API no está activo.
 */
export async function analyze(site: Site, date: string, signal?: AbortSignal): Promise<Scenario> {
  if (!useApi) return makeDemoScenario(site, date)
  {
    const response = await fetch(`${base}/api/scenarios/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ latitude: site.lat, longitude: site.lon, start_time: `${date}T00:00:00Z`, hours: 168, step_minutes: 60, use_dem_horizon: true }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || !('samples' in data) || !Array.isArray(data.samples) || data.samples.length < 2) throw new Error('Formato de respuesta inválido')
    const samples: Sample[] = data.samples.map((item: Record<string, unknown>, i: number) => ({
      hour: Number(item.hour ?? i),
      sunElevation: Number(item.sun_elevation), earthElevation: Number(item.earth_elevation),
      horizonSun: Number(item.horizon_sun ?? 0), horizonEarth: Number(item.horizon_earth ?? 0),
      sunVisible: Boolean(item.sun_visible), earthVisible: Boolean(item.earth_visible),
    }))
    if (samples.some(s => !Number.isFinite(s.sunElevation) || !Number.isFinite(s.earthElevation))) throw new Error('Datos incompletos')
    const raw = data as { metrics?: Record<string, unknown> }
    const supplied = raw.metrics
    if (!supplied) throw new Error('Faltan métricas del backend')
    const apiMetrics = {
      sunPercent: Number(supplied.sunPercent), earthPercent: Number(supplied.earthPercent),
      concurrentPercent: Number(supplied.concurrentPercent), longestDark: Number(supplied.longestDark),
      longestBlackout: Number(supplied.longestBlackout),
    }
    if (Object.values(apiMetrics).some(value => !Number.isFinite(value))) throw new Error('Métricas inválidas del backend')
    return { site, start: date, hours: 168, samples, source: 'api', apiMetrics }
  }
}
