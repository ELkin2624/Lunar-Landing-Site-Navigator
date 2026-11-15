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

export type CommsBand = 'S' | 'X' | 'Ka'

export type CommsConfig = {
  band: CommsBand
  peakDownlinkMbps: number
  minGrazingDeg: number
  dailyDataGenerationGb: number
  bufferCapacityGb: number
  initialBufferGb: number
}

export type CommsStep = {
  hour: number
  earthVisible: boolean
  earthDiskFraction: number
  clearanceDeg: number
  linkState: 'nominal' | 'degraded' | 'occulted'
  effectiveRateMbps: number
  downlinkedGb: number
  generatedGb: number
  bufferGb: number
  bufferFillPercent: number
  droppedGb: number
}

export type CommsSimulationResult = {
  config: CommsConfig
  commsViable: boolean
  nominalLinkPercent: number
  totalGeneratedGb: number
  totalDownlinkedGb: number
  totalDroppedGb: number
  peakBufferGb: number
  peakBufferPercent: number
  finalBufferGb: number
  averageEffectiveMbps: number
  summary: string
  steps: CommsStep[]
}

export const COMMS_PRESETS: Record<string, { name: string; tag: string; config: CommsConfig }> = {
  xband_lander: {
    name: 'Lander CLPS (Banda X)',
    tag: '10 Mbps · 12 GB/d · 32 GB SSR',
    config: { band: 'X', peakDownlinkMbps: 10, minGrazingDeg: 2.0, dailyDataGenerationGb: 12, bufferCapacityGb: 32, initialBufferGb: 0 },
  },
  ka_artemis: {
    name: 'Base / Hab (Banda Ka)',
    tag: '45 Mbps · 60 GB/d · 128 GB SSR',
    config: { band: 'Ka', peakDownlinkMbps: 45, minGrazingDeg: 3.0, dailyDataGenerationGb: 60, bufferCapacityGb: 128, initialBufferGb: 0 },
  },
  sband_rover: {
    name: 'Rover Polar (Banda S)',
    tag: '2.5 Mbps · 4 GB/d · 16 GB SSR',
    config: { band: 'S', peakDownlinkMbps: 2.5, minGrazingDeg: 1.5, dailyDataGenerationGb: 4, bufferCapacityGb: 16, initialBufferGb: 0 },
  },
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

export function computeCommsProfile(scenario: Scenario, config: CommsConfig): CommsSimulationResult {
  const samples = scenario.samples
  if (!samples.length) {
    return {
      config, commsViable: false, nominalLinkPercent: 0, totalGeneratedGb: 0,
      totalDownlinkedGb: 0, totalDroppedGb: 0, peakBufferGb: 0, peakBufferPercent: 0,
      finalBufferGb: 0, averageEffectiveMbps: 0, summary: 'Sin muestras disponibles.', steps: [],
    }
  }
  const stepMinutes = scenario.provenance?.samplingMinutes || scenario.stepMinutes || 60
  const fallbackDtHours = stepMinutes / 60
  let bufferGb = Math.min(config.bufferCapacityGb, Math.max(0, config.initialBufferGb))
  let peakBufferGb = bufferGb
  let totalGenGb = 0
  let totalDownGb = 0
  let totalDroppedGb = 0
  let nominalSteps = 0
  let rateSumMbps = 0
  const steps: CommsStep[] = []

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    const prevOffset = i > 0 ? (samples[i - 1].hourOffset ?? samples[i - 1].hour) : 0
    const curOffset = s.hourOffset ?? s.hour
    const dtHours = i > 0 ? Math.max(1 / 60, curOffset - prevOffset) : fallbackDtHours
    const genPerStepGb = (config.dailyDataGenerationGb / 24) * dtHours
    const clearanceDeg = s.earthElevation - s.horizonEarth
    const diskFrac = s.earthDiskFraction ?? (s.earthVisible ? 1.0 : 0.0)

    let effMbps = 0
    let linkState: 'nominal' | 'degraded' | 'occulted' = 'occulted'
    if (s.earthVisible && clearanceDeg > 0) {
      let linkFactor = 1.0
      if (clearanceDeg >= config.minGrazingDeg) {
        linkState = 'nominal'
        nominalSteps++
      } else {
        linkState = 'degraded'
        linkFactor = Math.max(0.15, clearanceDeg / Math.max(config.minGrazingDeg, 0.1))
      }
      effMbps = config.peakDownlinkMbps * diskFrac * linkFactor
    }

    const capGb = (effMbps * 3600 * dtHours) / 8000
    const availableGb = bufferGb + genPerStepGb
    const downlinkedGb = Math.min(availableGb, capGb)
    const unclampedBuffer = availableGb - downlinkedGb
    const droppedGb = Math.max(0, unclampedBuffer - config.bufferCapacityGb)
    bufferGb = Math.min(config.bufferCapacityGb, unclampedBuffer)

    peakBufferGb = Math.max(peakBufferGb, bufferGb)
    totalGenGb += genPerStepGb
    totalDownGb += downlinkedGb
    totalDroppedGb += droppedGb
    rateSumMbps += effMbps

    const fillPct = (bufferGb / Math.max(0.1, config.bufferCapacityGb)) * 100
    steps.push({
      hour: curOffset,
      earthVisible: s.earthVisible,
      earthDiskFraction: Number(diskFrac.toFixed(3)),
      clearanceDeg: Number(clearanceDeg.toFixed(2)),
      linkState,
      effectiveRateMbps: Number(effMbps.toFixed(2)),
      downlinkedGb: Number(downlinkedGb.toFixed(3)),
      generatedGb: Number(genPerStepGb.toFixed(3)),
      bufferGb: Number(bufferGb.toFixed(2)),
      bufferFillPercent: Number(fillPct.toFixed(1)),
      droppedGb: Number(droppedGb.toFixed(2)),
    })
  }

  const peakPct = Number(((peakBufferGb / Math.max(0.1, config.bufferCapacityGb)) * 100).toFixed(1))
  const nominalPct = Number(((nominalSteps / samples.length) * 100).toFixed(1))
  const avgMbps = Number((rateSumMbps / samples.length).toFixed(2))
  const finalGb = steps[steps.length - 1]?.bufferGb ?? 0
  const commsViable = totalDroppedGb === 0 && peakPct < 90

  let summary = `Retorno de datos viable en Banda ${config.band}: bajada efectiva de ${totalDownGb.toFixed(1)} GB (media ${avgMbps} Mbps, pico SSR ${peakPct}%).`
  if (totalDroppedGb > 0) {
    summary = `Desbordamiento de grabadora en Banda ${config.band}: se pierden ${totalDroppedGb.toFixed(2)} GB durante apagones terrestres. Aumenta SSR o Mbps.`
  } else if (peakPct >= 80) {
    summary = `Enlace en margen ajustado (Banda ${config.band}): cola alcanza ${peakBufferGb.toFixed(1)} GB (${peakPct}% del SSR); conviene relé lunar.`
  }

  return {
    config,
    commsViable,
    nominalLinkPercent: nominalPct,
    totalGeneratedGb: Number(totalGenGb.toFixed(2)),
    totalDownlinkedGb: Number(totalDownGb.toFixed(2)),
    totalDroppedGb: Number(totalDroppedGb.toFixed(2)),
    peakBufferGb: Number(peakBufferGb.toFixed(2)),
    peakBufferPercent: peakPct,
    finalBufferGb: Number(finalGb.toFixed(2)),
    averageEffectiveMbps: avgMbps,
    summary,
    steps,
  }
}
