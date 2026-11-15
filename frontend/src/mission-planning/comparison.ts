import { type Scenario } from '../data'

export type Priority = 'solar' | 'earth' | 'balanced'
export function longestWindow(scenario: Scenario, priority: Priority) {
  let current = 0, longest = 0
  for (const sample of scenario.samples.slice(0, -1)) {
    const visible = priority === 'solar' ? sample.sunVisible : priority === 'earth' ? sample.earthVisible : sample.sunVisible && sample.earthVisible
    current = visible ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}
export type ComparisonResults = { scenarios: Scenario[]; date: string; duration: number; priority: Priority }

