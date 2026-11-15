import { type Scenario } from '../data'

export type Priority = 'solar' | 'earth' | 'balanced'
export function longestWindow(scenario: Scenario, priority: Priority) {
  let current = 0, longest = 0
  // Each sample covers [start, end); a sample at or beyond the window end adds no time.
  for (let index = 0; index < scenario.samples.length; index++) {
    const sample = scenario.samples[index]
    const start = sample.hourOffset ?? sample.hour
    if (start >= scenario.hours) break
    const next = scenario.samples[index + 1]
    const end = next ? (next.hourOffset ?? next.hour) : scenario.hours
    const hours = Math.max(0, Math.min(scenario.hours, end) - start)
    const visible = priority === 'solar' ? sample.sunVisible : priority === 'earth' ? sample.earthVisible : sample.sunVisible && sample.earthVisible
    current = visible ? current + hours : 0
    longest = Math.max(longest, current)
  }
  return Number(longest.toFixed(2))
}
export type ComparisonResults = { scenarios: Scenario[]; date: string; duration: number; priority: Priority }
