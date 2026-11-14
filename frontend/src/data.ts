export type Site = { id: string; name: string; region: string; lat: number; lon: number; note: string }
export type Sample = { hour: number; sunElevation: number; earthElevation: number; sunAzimuth?: number; earthAzimuth?: number; horizonSun: number; horizonEarth: number; sunVisible: boolean; earthVisible: boolean }
export type HorizonPoint = { azimuth: number; elevation: number }
export type Scenario = { site: Site; start: string; hours: number; samples: Sample[]; source: 'demo' | 'api'; apiMetrics?: Metrics; horizonProfile?: HorizonPoint[] }
export type Metrics = { sunPercent: number; earthPercent: number; concurrentPercent: number; longestDark: number; longestBlackout: number }

// Estos puntos son muestras de interfaz, no ubicaciones de aterrizaje validadas.
export const SITES: Site[] = [
  { id: 'mouton', name: 'Mons Mouton', region: 'Región Artemis III', lat: -85.4, lon: -29.2, note: 'Meseta elevada, próxima al polo sur' },
  { id: 'malapert', name: 'Malapert Massif', region: 'Región Artemis III', lat: -86.0, lon: 3.8, note: 'Relieve alto y horizonte complejo' },
  { id: 'haworth', name: 'Haworth', region: 'Región Artemis III', lat: -87.6, lon: -4.1, note: 'Entorno de cráter de sombra persistente' },
  { id: 'gerlache', name: 'de Gerlache Rim 2', region: 'Región Artemis III', lat: -88.3, lon: -59.5, note: 'Borde de cráter próximo al polo' },
]

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const phase = (date: string) => (Date.parse(date + 'T00:00:00Z') / 3600000) || 0

export function makeDemoScenario(site: Site, start: string, hours = 168): Scenario {
  const index = SITES.findIndex(item => item.id === site.id)
  const offset = phase(start) / 24 * 0.24 + index * 0.85 + site.lon * 0.008
  const samples = Array.from({ length: hours + 1 }, (_, hour) => {
    const t = hour / 24
    const az = t * 0.38 + offset
    const sunElevation = 2.8 + 4.7 * Math.sin(az) + 1.15 * Math.sin(t * 1.8 + index)
    const earthElevation = 5.1 + 3.7 * Math.sin(t * 0.44 + index * 1.2 + offset * 0.3)
    const horizonSun = 1.5 + 3.3 * Math.max(0, Math.sin(t * 1.13 + index * 1.6))
    const horizonEarth = 1.1 + 4.2 * Math.max(0, Math.cos(t * 0.81 + index * 0.7))
    return { hour, sunElevation, earthElevation, horizonSun, horizonEarth, sunVisible: sunElevation > horizonSun, earthVisible: earthElevation > horizonEarth }
  })
  return { site, start, hours, samples, source: 'demo' }
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
