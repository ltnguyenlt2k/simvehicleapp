/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

describe('simulation store (M05-T09/T10)', () => {
  beforeEach(() => useSvSimulationStore.getState().clear())

  it('keeps the scenario draft per workflow so Simulate uses what the editor shows', () => {
    const scenario = { scenarioVersion: '1.0.0' as const, name: 's', until: 5000, inputs: [] }
    useSvSimulationStore.getState().setDraft('wf-1', scenario)
    expect(useSvSimulationStore.getState().draft).toEqual({ workflowId: 'wf-1', scenario })
  })

  it('a result moves the cursor to the end; the cursor stays within the run', () => {
    const s = useSvSimulationStore.getState()
    s.setResult('wf-1', '{}', 4000, { trace: [], writes: [], signals: [], publishes: [], logs: [] })
    expect(useSvSimulationStore.getState()).toMatchObject({ cursor: 4000, status: 'done' })
    s.setCursor(9999)
    expect(useSvSimulationStore.getState().cursor).toBe(4000)
    s.setCursor(-5)
    expect(useSvSimulationStore.getState().cursor).toBe(0)
  })
})
