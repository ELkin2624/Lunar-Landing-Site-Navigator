import { type Scenario, type Site, type Sample, type HorizonPoint, type Provenance, type SpatialUncertainty, type TimelineEventItem } from './data'

const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const useApi = import.meta.env.VITE_USE_API !== 'false'

/**
 * Contrato esperado: POST /api/scenarios/analyze con {latitude, longitude,
 * start_time, hours, step_minutes}. Respuesta: {samples:[{hour,
 * sun_elevation, earth_elevation, horizon_sun, horizon_earth,
 * sun_visible, earth_visible}]}. No se generan datos simulados si falla la API.
 */
export type AnalyzeOptions = {
  hours?: number
  stepMinutes?: number
  refineTransitions?: boolean
  refinementStepMinutes?: number
}

export async function analyze(site: Site, date: string, signal?: AbortSignal, options: AnalyzeOptions = {}): Promise<Scenario> {
  if (!useApi) throw new Error('La API está desactivada; activa VITE_USE_API')
  const hours = options.hours ?? 168
  const stepMinutes = options.stepMinutes ?? 60
  const refineTransitions = options.refineTransitions ?? false
  const refinementStepMinutes = options.refinementStepMinutes ?? 5
  {
    const response = await fetch(`${base}/api/scenarios/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        latitude: site.lat,
        longitude: site.lon,
        start_time: `${date}T00:00:00Z`,
        hours,
        step_minutes: stepMinutes,
        refine_transitions: refineTransitions,
        refinement_step_minutes: refinementStepMinutes,
        use_dem_horizon: true,
        spatial_uncertainty_radius_m: 240,
      }),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || !('samples' in data) || !Array.isArray(data.samples) || data.samples.length < 2) throw new Error('Formato de respuesta inválido')
    const samples: Sample[] = data.samples.map((item: Record<string, unknown>, i: number) => ({
      hour: Number(item.hour ?? i),
      hourOffset: item.hour_offset == null ? Number(item.hour ?? i) : Number(item.hour_offset),
      timeUtc: item.time_utc == null ? undefined : String(item.time_utc),
      sunAzimuth: Number(item.sun_azimuth), earthAzimuth: Number(item.earth_azimuth),
      sunElevation: Number(item.sun_elevation), earthElevation: Number(item.earth_elevation),
      horizonSun: Number(item.horizon_sun ?? 0), horizonEarth: Number(item.horizon_earth ?? 0),
      sunVisible: Boolean(item.sun_visible), earthVisible: Boolean(item.earth_visible),
      sunDiskFraction: item.sun_disk_fraction == null ? undefined : Number(item.sun_disk_fraction),
      earthDiskFraction: item.earth_disk_fraction == null ? undefined : Number(item.earth_disk_fraction),
    }))
    if (samples.some(s => !Number.isFinite(s.sunElevation) || !Number.isFinite(s.earthElevation))) throw new Error('Datos incompletos')
    if (samples.some(s => !Number.isFinite(s.sunAzimuth) || !Number.isFinite(s.earthAzimuth))) throw new Error('Faltan azimuts del backend')
    const raw = data as { metrics?: Record<string, unknown> }
    const rawProfile = (data as { horizon_profile?: unknown }).horizon_profile
    if (!Array.isArray(rawProfile) || rawProfile.length < 2) throw new Error('Falta el perfil de horizonte LOLA')
    const horizonProfile: HorizonPoint[] = rawProfile.map((point: Record<string, unknown>) => ({
      azimuth: Number(point.azimuth_deg), elevation: Number(point.elevation_deg),
      obstacleDistanceKm: point.obstacle_distance_km == null ? undefined : Number(point.obstacle_distance_km),
      obstacleSource: point.obstacle_source == null ? undefined : String(point.obstacle_source),
      obstaclePixelScaleM: point.obstacle_pixel_scale_m == null ? undefined : Number(point.obstacle_pixel_scale_m),
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
    const spatial = metadata.spatial_uncertainty as Record<string, unknown> | null
    const spatialUncertainty: SpatialUncertainty | undefined = spatial ? {
      radiusM: Number(spatial.radius_m), sitesEvaluated: Number(spatial.sites_evaluated),
      sunlitPercentRange: spatial.sunlit_percent_range as number[], earthVisiblePercentRange: spatial.earth_visible_percent_range as number[],
      longestDarknessHoursRange: spatial.longest_darkness_hours_range as number[], longestEarthBlackoutHoursRange: spatial.longest_earth_blackout_hours_range as number[],
      demVerticalSigmaM: spatial.dem_vertical_sigma_m == null ? undefined : Number(spatial.dem_vertical_sigma_m),
      landingDispersionSigma: spatial.landing_dispersion_sigma == null ? undefined : Number(spatial.landing_dispersion_sigma),
      horizonEnvelopeDeg: spatial.horizon_envelope_deg == null ? undefined : Number(spatial.horizon_envelope_deg),
      method: String(spatial.method),
    } : undefined
    const rawEvents = Array.isArray(metadata.events) ? metadata.events : []
    const events: TimelineEventItem[] = rawEvents.map((ev: Record<string, unknown>) => ({
      timeUtc: String(ev.time_utc),
      kind: ev.kind as TimelineEventItem['kind'],
      bracketStartUtc: String(ev.bracket_start_utc),
      bracketEndUtc: String(ev.bracket_end_utc),
      estimatedTimeUtc: String(ev.estimated_time_utc),
      method: String(ev.method ?? 'sample_grid'),
    }))
    const provenance: Provenance = {
      ephemerisSource: String(metadata.ephemeris_source), horizonSource: String(metadata.source),
      demPixelScaleM: metadata.dem_pixel_scale_m == null ? null : Number(metadata.dem_pixel_scale_m),
      samplingMinutes: Number(metadata.sampling_minutes), transitionUncertaintyMinutes: Number(metadata.transition_uncertainty_minutes),
      precisionNote: String(metadata.precision_note),
      terrainSources: Array.isArray(metadata.terrain_sources) ? metadata.terrain_sources.map(String) : [],
      spatialUncertainty,
    }
    if (![provenance.samplingMinutes, provenance.transitionUncertaintyMinutes].every(Number.isFinite)
      || !metadata.ephemeris_source || !metadata.source || !metadata.precision_note) throw new Error('Metadatos de precisión inválidos')
    return {
      site,
      start: date,
      hours: Number(metadata.hours ?? hours),
      stepMinutes: provenance.samplingMinutes,
      refineTransitions,
      samples,
      source: 'api',
      apiMetrics,
      horizonProfile,
      provenance,
      events,
    }
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

export async function fetchNacTexture(site: Site, spanM: number, signal?: AbortSignal): Promise<{ url: string; pixelM: number; coverage: number }> {
  const query = new URLSearchParams({ latitude_deg: String(site.lat), longitude_deg: String(site.lon), span_m: String(spanM) })
  const response = await fetch(`${base}/api/v1/terrain/nac-texture?${query}`, { signal })
  if (!response.ok) throw new Error(`NAC no disponible (HTTP ${response.status})`)
  const blob = await response.blob()
  return { url: URL.createObjectURL(blob), pixelM: Number(response.headers.get('X-Texture-Pixel-M')),
    coverage: Number(response.headers.get('X-Tile-Coverage-Fraction')) }
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

export type MissionDeltaResponse = {
  rescheduledSite: { latitudeDeg: number; longitudeDeg: number; label: string }
  rescheduledStartUtc: string
  rescheduledEndUtc: string
  delayTotalHours: number
  displacementMeters: number
  displacementAzimuthDeg: number
  metrics: {
    deltaSunlitPercent: number
    deltaEarthVisiblePercent: number
    deltaConcurrentPercent: number
    deltaLongestDarknessHours: number
    deltaLongestBlackoutHours: number
    constraintsStatusChanged: boolean
    baselineMetConstraints: boolean
    rescheduledMetConstraints: boolean
  }
  riskLevel: 'LOW' | 'MODERATE' | 'CRITICAL'
  executiveSummary: string
  impacts: string[]
  recommendations: string[]
  rescheduledMetrics: {
    sunPercent: number
    earthPercent: number
    concurrentPercent: number
    longestDark: number
    longestBlackout: number
  }
}

export async function fetchMissionDelta(
  site: Site,
  date: string,
  delayDays: number,
  delayHours: number,
  displacementMeters: number,
  displacementAzimuthDeg: number,
  constraints: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number },
  signal?: AbortSignal,
): Promise<MissionDeltaResponse> {
  if (!useApi) throw new Error('Mission Delta requiere el backend activo')
  const startUtc = `${date}T00:00:00Z`
  const endUtc = new Date(Date.parse(startUtc) + 168 * 3600000).toISOString()
  const response = await fetch(`${base}/api/v1/scenarios/delta`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({
      baseline_scenario: {
        site: { latitude_deg: site.lat, longitude_deg: site.lon, label: site.name },
        start_utc: startUtc,
        end_utc: endUtc,
        step_minutes: 60,
        use_dem_horizon: true,
        constraints: {
          min_sunlit_fraction: constraints.minSunPercent / 100,
          min_earth_visible_fraction: constraints.minEarthPercent / 100,
          max_earth_blackout_hours: constraints.maxBlackoutHours,
        },
      },
      delay_days: delayDays,
      delay_hours: delayHours,
      displacement_meters: displacementMeters,
      displacement_azimuth_deg: displacementAzimuthDeg,
    }),
  })
  if (!response.ok) throw new Error(`Delta HTTP ${response.status}`)
  const d = await response.json() as Record<string, any>
  const m = d.metrics ?? {}
  const rm = d.rescheduled?.metrics ?? {}
  return {
    rescheduledSite: {
      latitudeDeg: Number(d.rescheduled_site?.latitude_deg),
      longitudeDeg: Number(d.rescheduled_site?.longitude_deg),
      label: String(d.rescheduled_site?.label ?? site.name),
    },
    rescheduledStartUtc: String(d.rescheduled_start_utc),
    rescheduledEndUtc: String(d.rescheduled_end_utc),
    delayTotalHours: Number(d.delay_total_hours),
    displacementMeters: Number(d.displacement_meters),
    displacementAzimuthDeg: Number(d.displacement_azimuth_deg),
    metrics: {
      deltaSunlitPercent: Number(m.delta_sunlit_percent),
      deltaEarthVisiblePercent: Number(m.delta_earth_visible_percent),
      deltaConcurrentPercent: Number(m.delta_concurrent_percent),
      deltaLongestDarknessHours: Number(m.delta_longest_darkness_hours),
      deltaLongestBlackoutHours: Number(m.delta_longest_blackout_hours),
      constraintsStatusChanged: Boolean(m.constraints_status_changed),
      baselineMetConstraints: Boolean(m.baseline_met_constraints),
      rescheduledMetConstraints: Boolean(m.rescheduled_met_constraints),
    },
    riskLevel: (d.risk_level || 'LOW') as 'LOW' | 'MODERATE' | 'CRITICAL',
    executiveSummary: String(d.executive_summary ?? ''),
    impacts: Array.isArray(d.impacts) ? d.impacts.map(String) : [],
    recommendations: Array.isArray(d.recommendations) ? d.recommendations.map(String) : [],
    rescheduledMetrics: {
      sunPercent: Math.round(Number(rm.sunlit_fraction ?? 0) * 100),
      earthPercent: Math.round(Number(rm.earth_visible_fraction ?? 0) * 100),
      concurrentPercent: Math.round(Number(rm.concurrent_fraction ?? 0) * 100),
      longestDark: Number(rm.longest_darkness_hours ?? 0),
      longestBlackout: Number(rm.longest_earth_blackout_hours ?? 0),
    },
  }
}

export type RankedSiteItem = {
  rank: number
  label: string
  latitudeDeg: number
  longitudeDeg: number
  score: number
  sunlitPercent: number
  earthVisiblePercent: number
  concurrentPercent: number
  longestDarknessHours: number
  longestBlackoutHours: number
  constraintsMet: boolean
  highlights: string[]
  tradeoffs: string[]
}

export type RankingResult = {
  bestSite: string
  executiveSummary: string
  rankedSites: RankedSiteItem[]
}

export async function fetchRankedSites(
  sites: Site[],
  date: string,
  weights: { sun: number; earth: number; concurrent: number; darknessPenalty: number; blackoutPenalty: number },
  constraints: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number },
  signal?: AbortSignal,
): Promise<RankingResult> {
  if (!useApi) throw new Error('El ranking requiere el backend activo')
  const startUtc = `${date}T00:00:00Z`
  const endUtc = new Date(Date.parse(startUtc) + 168 * 3600000).toISOString()
  const response = await fetch(`${base}/api/v1/scenarios/rank`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({
      scenarios: sites.map(s => ({
        site: { latitude_deg: s.lat, longitude_deg: s.lon, label: s.name },
        start_utc: startUtc,
        end_utc: endUtc,
        step_minutes: 60,
        use_dem_horizon: true,
        constraints: {
          min_sunlit_fraction: constraints.minSunPercent / 100,
          min_earth_visible_fraction: constraints.minEarthPercent / 100,
          max_earth_blackout_hours: constraints.maxBlackoutHours,
        },
      })),
      weights: {
        sun: weights.sun,
        earth: weights.earth,
        concurrent: weights.concurrent,
        darkness_penalty: weights.darknessPenalty,
        blackout_penalty: weights.blackoutPenalty,
      },
    }),
  })
  if (!response.ok) throw new Error(`Ranking HTTP ${response.status}`)
  const d = await response.json() as Record<string, any>
  return {
    bestSite: String(d.best_site ?? ''),
    executiveSummary: String(d.executive_summary ?? ''),
    rankedSites: (Array.isArray(d.ranked_sites) ? d.ranked_sites : []).map((r: Record<string, any>) => ({
      rank: Number(r.rank),
      label: String(r.label),
      latitudeDeg: Number(r.latitude_deg),
      longitudeDeg: Number(r.longitude_deg),
      score: Number(r.score),
      sunlitPercent: Number(r.sunlit_percent),
      earthVisiblePercent: Number(r.earth_visible_percent),
      concurrentPercent: Number(r.concurrent_percent),
      longestDarknessHours: Number(r.longest_darkness_hours),
      longestBlackoutHours: Number(r.longest_blackout_hours),
      constraintsMet: Boolean(r.constraints_met),
      highlights: Array.isArray(r.highlights) ? r.highlights.map(String) : [],
      tradeoffs: Array.isArray(r.tradeoffs) ? r.tradeoffs.map(String) : [],
    })),
  }
}

export async function parseNaturalConstraints(prompt: string): Promise<{
  minSunPercent?: number
  minEarthPercent?: number
  maxDarknessHours?: number
  maxBlackoutHours?: number
  minEarthElevationDeg?: number
}> {
  const response = await fetch(`${base}/api/v1/copilot/parse-constraints`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const d = await response.json() as Record<string, any>
  return {
    minSunPercent: d.min_sunlit_fraction ? Math.round(Number(d.min_sunlit_fraction) * 100) : undefined,
    minEarthPercent: d.min_earth_visible_fraction ? Math.round(Number(d.min_earth_visible_fraction) * 100) : undefined,
    maxDarknessHours: d.max_darkness_hours != null ? Number(d.max_darkness_hours) : undefined,
    maxBlackoutHours: d.max_earth_blackout_hours != null ? Number(d.max_earth_blackout_hours) : undefined,
    minEarthElevationDeg: d.min_earth_elevation_deg ? Number(d.min_earth_elevation_deg) : undefined,
  }
}

function buildScenarioPayload(
  site: Site,
  date: string,
  options: {
    hours?: number
    stepMinutes?: number
    refineTransitions?: boolean
    refinementStepMinutes?: number
    constraints?: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number }
  },
) {
  const hours = options.hours ?? 168
  const requestedStep = options.stepMinutes ?? 60
  const safeStep = (hours * 60) / requestedStep > 500 ? 60 : requestedStep
  const startUtc = `${date}T00:00:00Z`
  const endUtc = new Date(Date.parse(startUtc) + hours * 3600000).toISOString()
  return {
    site: { latitude_deg: site.lat, longitude_deg: site.lon, label: site.name },
    start_utc: startUtc,
    end_utc: endUtc,
    step_minutes: safeStep,
    refine_transitions: options.refineTransitions ?? false,
    refinement_step_minutes: options.refinementStepMinutes ?? 5,
    use_dem_horizon: true,
    spatial_uncertainty_radius_m: 240,
    ...(options.constraints ? {
      constraints: {
        min_sunlit_fraction: options.constraints.minSunPercent / 100,
        min_earth_visible_fraction: options.constraints.minEarthPercent / 100,
        max_earth_blackout_hours: options.constraints.maxBlackoutHours,
      },
    } : {}),
  }
}

export type CopilotAskResult = {
  title: string
  verdict: string
  directAnswer: string | null
  scientificExplanation: string
  suggestedActions: string[]
}

export async function askCopilot(
  site: Site,
  date: string,
  userQuery: string,
  options: {
    hours?: number
    stepMinutes?: number
    refineTransitions?: boolean
    constraints?: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number }
  } = {},
  signal?: AbortSignal,
): Promise<CopilotAskResult> {
  if (!useApi) throw new Error('El copiloto requiere el backend activo')
  const response = await fetch(`${base}/api/v1/copilot/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      scenario: buildScenarioPayload(site, date, options),
      user_query: userQuery,
    }),
  })
  if (!response.ok) throw new Error(`Copiloto HTTP ${response.status}`)
  const d = await response.json() as Record<string, any>
  return {
    title: String(d.title ?? ''),
    verdict: String(d.verdict ?? ''),
    directAnswer: d.direct_answer == null ? null : String(d.direct_answer),
    scientificExplanation: String(d.scientific_explanation ?? ''),
    suggestedActions: Array.isArray(d.suggested_actions) ? d.suggested_actions.map(String) : [],
  }
}

export async function exportScenarioCsv(
  site: Site,
  date: string,
  options: {
    hours?: number
    stepMinutes?: number
    refineTransitions?: boolean
    constraints?: { minSunPercent: number; minEarthPercent: number; maxBlackoutHours: number }
  } = {},
): Promise<Blob> {
  if (!useApi) throw new Error('La exportación CSV requiere el backend activo')
  const response = await fetch(`${base}/api/v1/scenarios/export/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildScenarioPayload(site, date, options)),
  })
  if (!response.ok) throw new Error(`CSV HTTP ${response.status}`)
  return response.blob()
}
