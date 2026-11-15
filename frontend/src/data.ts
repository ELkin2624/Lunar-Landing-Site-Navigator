export type Site = { id: string; name: string; region: string; lat: number; lon: number; note: string }
export type Sample = { hour: number; sunElevation: number; earthElevation: number; sunAzimuth?: number; earthAzimuth?: number; horizonSun: number; horizonEarth: number; sunVisible: boolean; earthVisible: boolean }
export type HorizonPoint = { azimuth: number; elevation: number }
export type Provenance = { ephemerisSource: string; horizonSource: string; demPixelScaleM: number | null; samplingMinutes: number; transitionUncertaintyMinutes: number; precisionNote: string }
export type Scenario = { site: Site; start: string; hours: number; samples: Sample[]; source: 'unavailable' | 'api'; apiMetrics?: Metrics; horizonProfile?: HorizonPoint[]; provenance?: Provenance }
export type Metrics = { sunPercent: number; earthPercent: number; concurrentPercent: number; longestDark: number; longestBlackout: number }

// Mouton, Malapert y Haworth usan el centro oficial del IAU Gazetteer; de Gerlache Rim 2 es aproximado.
// No son ubicaciones de aterrizaje validadas.
// Mouton, Malapert y Haworth usan el centro oficial del IAU Gazetteer; de Gerlache Rim 2 es aproximado.
// No son ubicaciones de aterrizaje validadas.
export const SITES: Site[] = [
  { id: 'mouton', name: 'Mons Mouton', region: 'Región Artemis III', lat: -84.6, lon: 31.0, note: 'Macizo elevado, próximo al polo sur' },
  { id: 'malapert', name: 'Mons Malapert', region: 'Región Artemis III', lat: -85.98, lon: -1.67, note: 'Relieve alto y horizonte complejo' },
  { id: 'haworth', name: 'Haworth (fondo)', region: 'Región Polar Sur', lat: -87.45, lon: -5.17, note: 'Fondo de cráter en sombra permanente' },
  { id: 'gerlache', name: 'de Gerlache Rim 2', region: 'Región Artemis III', lat: -88.3, lon: -59.5, note: 'Borde de cráter próximo al polo' },
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
