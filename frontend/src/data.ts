export type Site = { id: string; name: string; region: string; lat: number; lon: number; note: string; artemis?: boolean; heightKm?: number; coordSource?: string }
export type Sample = { hour: number; hourOffset?: number; timeUtc?: string; sunElevation: number; earthElevation: number; sunAzimuth?: number; earthAzimuth?: number; horizonSun: number; horizonEarth: number; sunVisible: boolean; earthVisible: boolean; sunDiskFraction?: number; earthDiskFraction?: number }
export type HorizonPoint = { azimuth: number; elevation: number; obstacleDistanceKm?: number; obstacleSource?: string; obstaclePixelScaleM?: number }
export type SpatialUncertainty = {
  radiusM: number
  sitesEvaluated: number
  sunlitPercentRange: number[]
  earthVisiblePercentRange: number[]
  longestDarknessHoursRange: number[]
  longestEarthBlackoutHoursRange: number[]
  demVerticalSigmaM?: number
  landingDispersionSigma?: number
  horizonEnvelopeDeg?: number
  method: string
}
export type TimelineEventItem = { timeUtc: string; kind: 'sun_visibility_start' | 'sun_visibility_end' | 'earth_visibility_start' | 'earth_visibility_end'; bracketStartUtc: string; bracketEndUtc: string; estimatedTimeUtc: string; method: string }
export type Provenance = { ephemerisSource: string; horizonSource: string; demPixelScaleM: number | null; samplingMinutes: number; transitionUncertaintyMinutes: number; precisionNote: string; terrainSources: string[]; spatialUncertainty?: SpatialUncertainty }
export type Scenario = { site: Site; start: string; hours: number; stepMinutes?: number; refineTransitions?: boolean; samples: Sample[]; source: 'unavailable' | 'api'; apiMetrics?: Metrics; horizonProfile?: HorizonPoint[]; provenance?: Provenance; events?: TimelineEventItem[] }
export type Metrics = { sunPercent: number; earthPercent: number; concurrentPercent: number; longestDark: number; longestBlackout: number }

export type PowerConfig = {
  solarPanelAreaM2: number
  panelEfficiency: number
  baseLoadWatts: number
  batteryCapacityWh: number
  initialSocPercent: number
  minAllowableSocPercent: number
}

export type PowerStep = {
  hour: number
  sunVisible: boolean
  sunDiskFraction: number
  powerGeneratedW: number
  netPowerW: number
  batteryEnergyWh: number
  socPercent: number
}

export type PowerSimulationResult = {
  config: PowerConfig
  survivesMission: boolean
  minSocPercent: number
  finalSocPercent: number
  totalEnergyGeneratedKwh: number
  totalEnergyConsumedKwh: number
  criticalThresholdBreached: boolean
  blackoutHoursSupported: number
  summary: string
  steps: PowerStep[]
}

// Sitios del catálogo polar sur (IAU Gazetteer para centros de estructuras; aproximados para bordes Artemis III).
export const SITES: Site[] = [
  { id: 'mouton', name: 'Mons Mouton', region: 'Región Artemis III', lat: -84.6, lon: 31.0, note: 'Macizo elevado (~5 km), horizonte amplio', artemis: true, heightKm: 5.0 },
  { id: 'malapert', name: 'Mons Malapert', region: 'Región Artemis III', lat: -85.98, lon: -1.67, note: 'Cresta orientada hacia la Tierra', artemis: true, heightKm: 4.9 },
  { id: 'gerlache', name: 'de Gerlache Rim 2', region: 'Región Artemis III', lat: -88.3, lon: -59.5, note: 'Borde de cráter próximo al polo (cobertura 20 m)', artemis: true, heightKm: -0.1 },
  { id: 'shackleton', name: 'Shackleton Rim', region: 'Región Artemis III', lat: -89.9, lon: 0.0, note: 'Borde polar (89.9° S, cobertura 20 m)', artemis: true, heightKm: 0.7 },
  { id: 'connecting-ridge', name: 'Connecting Ridge', region: 'Región Artemis III', lat: -89.4, lon: -137.5, note: 'Cresta entre Shackleton y de Gerlache (20 m)', artemis: true, heightKm: 1.8 },
  { id: 'haworth', name: 'Haworth (fondo PSR)', region: 'Trampa fría polar', lat: -87.45, lon: -5.17, note: 'Fondo en sombra permanente (contraste)', artemis: false, heightKm: -3.3 },
  { id: 'nobile', name: 'Cráter Nobile', region: 'Región Polar Sur', lat: -85.28, lon: 53.27, note: 'Zona de prospección de volátiles', artemis: false, heightKm: 0.9 },
]

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
export function emptyScenario(site: Site, start: string): Scenario {
  return { site, start, hours: 168, samples: [], source: 'unavailable' }
}

function longestRun(samples: Sample[], key: 'sunVisible' | 'earthVisible') {
  let run = 0, max = 0
  for (const sample of samples.slice(0, -1)) {
    run = sample[key] ? 0 : run + 1
    max = Math.max(max, run)
  }
  return max
}

export function metrics(scenario: Scenario): Metrics {
  if (scenario.apiMetrics) return scenario.apiMetrics
  const samples = scenario.samples.slice(0, -1)
  const count = samples.length || 1
  return {
    sunPercent: Math.round(samples.filter(s => s.sunVisible).length / count * 100),
    earthPercent: Math.round(samples.filter(s => s.earthVisible).length / count * 100),
    concurrentPercent: Math.round(samples.filter(s => s.sunVisible && s.earthVisible).length / count * 100),
    longestDark: longestRun(scenario.samples, 'sunVisible'),
    longestBlackout: longestRun(scenario.samples, 'earthVisible'),
  }
}

export function verdict(m: Metrics, minSun: number, minEarth: number, maxBlackout: number) {
  const passed = [m.sunPercent >= minSun, m.earthPercent >= minEarth, m.longestBlackout <= maxBlackout]
  return { passed, count: passed.filter(Boolean).length, feasible: passed.every(Boolean) }
}

export function formatHour(start: string, hour: number) {
  const date = new Date(Date.parse(start + 'T00:00:00Z') + hour * 3600000)
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date) + ' UTC'
}

export function chartPath(values: number[], width: number, height: number, min: number, max: number) {
  return values.map((value, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, values.length - 1) * width).toFixed(1)},${(height - clamp((value - min) / (max - min), 0, 1) * height).toFixed(1)}`).join(' ')
}

const LUNAR_SOLAR_CONSTANT_W_M2 = 1361.0

export function computePowerProfile(scenario: Scenario, config: PowerConfig): PowerSimulationResult {
  const samples = scenario.samples
  if (!samples.length) {
    return {
      config, survivesMission: false, minSocPercent: 0, finalSocPercent: 0,
      totalEnergyGeneratedKwh: 0, totalEnergyConsumedKwh: 0, criticalThresholdBreached: true,
      blackoutHoursSupported: 0, summary: 'Sin muestras disponibles.', steps: [],
    }
  }
  const stepMinutes = scenario.provenance?.samplingMinutes || scenario.stepMinutes || 60
  const fallbackDtHours = stepMinutes / 60
  let currentWh = config.batteryCapacityWh * (config.initialSocPercent / 100)
  let minWh = currentWh
  let totalGenWh = 0
  let totalLoadWh = 0
  let breached = false
  let survives = true
  const steps: PowerStep[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const prevOffset = i > 0 ? (samples[i - 1].hourOffset ?? samples[i - 1].hour) : 0
    const curOffset = s.hourOffset ?? s.hour
    const dtHours = i > 0 ? Math.max(1 / 60, curOffset - prevOffset) : fallbackDtHours
    const elDeg = s.sunElevation
    const diskFrac = s.sunDiskFraction ?? (s.sunVisible ? 1.0 : 0.0)
    let powerGen = 0
    if (s.sunVisible && elDeg > s.horizonSun) {
      const cosFactor = Math.max(0, Math.cos(Math.max(0, elDeg) * Math.PI / 180))
      powerGen = LUNAR_SOLAR_CONSTANT_W_M2 * config.solarPanelAreaM2 * config.panelEfficiency * cosFactor * diskFrac
    }
    const netW = powerGen - config.baseLoadWatts
    const deltaWh = netW * dtHours
    currentWh = Math.min(config.batteryCapacityWh, Math.max(0, currentWh + deltaWh))
    minWh = Math.min(minWh, currentWh)
    totalGenWh += powerGen * dtHours
    totalLoadWh += config.baseLoadWatts * dtHours
    const soc = (currentWh / config.batteryCapacityWh) * 100
    if (soc < config.minAllowableSocPercent) breached = true
    if (currentWh <= 0) survives = false
    steps.push({
      hour: curOffset,
      sunVisible: s.sunVisible,
      sunDiskFraction: Number(diskFrac.toFixed(3)),
      powerGeneratedW: Number(powerGen.toFixed(1)),
      netPowerW: Number(netW.toFixed(1)),
      batteryEnergyWh: Number(currentWh.toFixed(1)),
      socPercent: Number(soc.toFixed(1)),
    })
  }
  const minSoc = Number(((minWh / config.batteryCapacityWh) * 100).toFixed(1))
  const finalSoc = steps[steps.length - 1]?.socPercent ?? 0
  const maxAutonomyHours = Number(((config.batteryCapacityWh * (1 - config.minAllowableSocPercent / 100)) / Math.max(1, config.baseLoadWatts)).toFixed(1))
  let summary = `Viable: SoC mínimo ${minSoc}% (reserva ≥ ${config.minAllowableSocPercent}%). Autonomía en sombra hasta reserva: ${maxAutonomyHours} h.`
  if (survives && breached) {
    summary = `Alerta de reserva: cae a ${minSoc}% (bajo el umbral de ${config.minAllowableSocPercent}%), aunque no llega a 0%.`
  } else if (!survives) {
    summary = `Agotamiento energético (0% SoC) durante sombra prolongada. Requiere más batería, menor consumo o sitio más iluminado.`
  }
  return {
    config,
    survivesMission: survives,
    minSocPercent: minSoc,
    finalSocPercent: finalSoc,
    totalEnergyGeneratedKwh: Number((totalGenWh / 1000).toFixed(2)),
    totalEnergyConsumedKwh: Number((totalLoadWh / 1000).toFixed(2)),
    criticalThresholdBreached: breached,
    blackoutHoursSupported: maxAutonomyHours,
    summary,
    steps,
  }
}
