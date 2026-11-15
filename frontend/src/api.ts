import { type Scenario, type Site, type Sample, type HorizonPoint, type Provenance } from './data'

const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const useApi = import.meta.env.VITE_USE_API !== 'false'

/**
 * Contrato esperado: POST /api/scenarios/analyze con {latitude, longitude,
 * start_time, hours, step_minutes}. Respuesta: {samples:[{hour,
 * sun_elevation, earth_elevation, horizon_sun, horizon_earth,
 * sun_visible, earth_visible}]}. No se generan datos simulados si falla la API.
 */
export async function analyze(site: Site, date: string, signal?: AbortSignal): Promise<Scenario> {
  if (!useApi) throw new Error('La API está desactivada; activa VITE_USE_API')
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
      sunAzimuth: Number(item.sun_azimuth), earthAzimuth: Number(item.earth_azimuth),
      sunElevation: Number(item.sun_elevation), earthElevation: Number(item.earth_elevation),
      horizonSun: Number(item.horizon_sun ?? 0), horizonEarth: Number(item.horizon_earth ?? 0),
      sunVisible: Boolean(item.sun_visible), earthVisible: Boolean(item.earth_visible),
    }))
    if (samples.some(s => !Number.isFinite(s.sunElevation) || !Number.isFinite(s.earthElevation))) throw new Error('Datos incompletos')
    if (samples.some(s => !Number.isFinite(s.sunAzimuth) || !Number.isFinite(s.earthAzimuth))) throw new Error('Faltan azimuts del backend')
    const raw = data as { metrics?: Record<string, unknown> }
    const rawProfile = (data as { horizon_profile?: unknown }).horizon_profile
    if (!Array.isArray(rawProfile) || rawProfile.length < 2) throw new Error('Falta el perfil de horizonte LOLA')
    const horizonProfile: HorizonPoint[] = rawProfile.map((point: Record<string, unknown>) => ({
      azimuth: Number(point.azimuth_deg), elevation: Number(point.elevation_deg),
    }))
    if (horizonProfile.some(p => !Number.isFinite(p.azimuth) || !Number.isFinite(p.elevation))) throw new Error('Perfil de horizonte inválido')
    const supplied = raw.metrics
    if (!supplied) throw new Error('Faltan métricas del backend')
    const apiMetrics = {
      sunPercent: Number(supplied.sunPercent), earthPercent: Number(supplied.earthPercent),
      concurrentPercent: Number(supplied.concurrentPercent), longestDark: Number(supplied.longestDark),
      longestBlackout: Number(supplied.longestBlackout),
    }
    if (Object.values(apiMetrics).some(value => !Number.isFinite(value))) throw new Error('Métricas inválidas del backend')
    const metadata = data as Record<string, unknown>
    const provenance: Provenance = {
      ephemerisSource: String(metadata.ephemeris_source), horizonSource: String(metadata.source),
      demPixelScaleM: metadata.dem_pixel_scale_m == null ? null : Number(metadata.dem_pixel_scale_m),
      samplingMinutes: Number(metadata.sampling_minutes), transitionUncertaintyMinutes: Number(metadata.transition_uncertainty_minutes),
      precisionNote: String(metadata.precision_note),
    }
    if (![provenance.samplingMinutes, provenance.transitionUncertaintyMinutes].every(Number.isFinite)
      || !metadata.ephemeris_source || !metadata.source || !metadata.precision_note) throw new Error('Metadatos de precisión inválidos')
    return { site, start: date, hours: 168, samples, source: 'api', apiMetrics, horizonProfile, provenance }
  }
}

export type SlopeScale = { baselineM: number; slopeDeg: number; aspectDeg: number | null }
export type SlopeResult = {
  slopeDeg: number; aspectDeg: number | null; baselineM: number; pixelScaleM: number; groundSpacingM: number
  multiscale: SlopeScale[]
  neighborhood: { radiusM: number; cells: number; meanDeg: number; p90Deg: number; maxDeg: number; fractionAboveThreshold: number | null }
  thresholdDeg: number | null; thresholdStatus: 'not_evaluated' | 'at_or_below_user_threshold' | 'above_user_threshold'
  source: string; note: string
}

export const apiEnabled = useApi

export type TerrainMesh = {
  gridSize: number; gridSpacingM: number; groundSpacingM: number; spanM: number
  centerXM: number; centerYM: number
  heightsM: number[]; minHeightM: number; maxHeightM: number; source: string; projection: string; note: string
}

export async function fetchTerrainMesh(site: Site, signal?: AbortSignal): Promise<TerrainMesh> {
  if (!useApi) throw new Error('La vista 3D requiere el backend y el DEM LOLA')
  const response = await fetch(`${base}/api/v1/terrain/mesh`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ site: { latitude_deg: site.lat, longitude_deg: site.lon } }),
  })
  if (!response.ok) throw new Error(`Malla LOLA: HTTP ${response.status}`)
  const data = await response.json() as Record<string, unknown>
  const mesh: TerrainMesh = {
    gridSize: Number(data.grid_size), gridSpacingM: Number(data.grid_spacing_m),
    groundSpacingM: Number(data.ground_spacing_m), spanM: Number(data.span_m),
    centerXM: Number(data.center_x_m), centerYM: Number(data.center_y_m),
    heightsM: Array.isArray(data.heights_m) ? data.heights_m.map(Number) : [],
    minHeightM: Number(data.min_height_m), maxHeightM: Number(data.max_height_m),
    source: String(data.source), projection: String(data.projection), note: String(data.note),
  }
  if (![41, 101].includes(mesh.gridSize) || mesh.heightsM.length !== mesh.gridSize ** 2 || mesh.heightsM.some(value => !Number.isFinite(value))) throw new Error('Malla LOLA inválida')
  return mesh
}

/** Regional slope from LOLA (POST /api/v1/terrain/slope). There is no demo fallback. */
export async function fetchSlope(site: Site, baselinePixels: number, radiusM: number, thresholdDeg: number, signal?: AbortSignal): Promise<SlopeResult> {
  if (!useApi) throw new Error('La pendiente requiere el backend con el DEM LOLA (VITE_USE_API=true)')
  const response = await fetch(`${base}/api/v1/terrain/slope`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ site: { latitude_deg: site.lat, longitude_deg: site.lon }, baseline_pixels: baselinePixels, neighborhood_radius_m: radiusM, threshold_deg: thresholdDeg }),
  })
  if (!response.ok) {
    const detail = await response.json().then((body: { detail?: unknown }) => body.detail, () => null)
    throw new Error(typeof detail === 'string' ? detail : `HTTP ${response.status}`)
  }
  const d = await response.json() as Record<string, any>
  const n = d.neighborhood ?? {}
  const result: SlopeResult = {
    slopeDeg: Number(d.slope_deg), aspectDeg: d.aspect_deg == null ? null : Number(d.aspect_deg),
    baselineM: Number(d.baseline_m), pixelScaleM: Number(d.pixel_scale_m), groundSpacingM: Number(d.ground_spacing_m),
    multiscale: (Array.isArray(d.multiscale) ? d.multiscale : []).map((s: Record<string, unknown>) => ({ baselineM: Number(s.baseline_m), slopeDeg: Number(s.slope_deg), aspectDeg: s.aspect_deg == null ? null : Number(s.aspect_deg) })),
    neighborhood: { radiusM: Number(n.radius_m), cells: Number(n.cells), meanDeg: Number(n.mean_deg), p90Deg: Number(n.p90_deg), maxDeg: Number(n.max_deg), fractionAboveThreshold: n.fraction_above_threshold == null ? null : Number(n.fraction_above_threshold) },
    thresholdDeg: d.threshold_deg == null ? null : Number(d.threshold_deg), thresholdStatus: d.threshold_status,
    source: String(d.source), note: String(d.note),
  }
  if (![result.slopeDeg, result.baselineM, result.neighborhood.meanDeg, result.neighborhood.maxDeg].every(Number.isFinite)) throw new Error('Respuesta de pendiente inválida')
  return result
}
