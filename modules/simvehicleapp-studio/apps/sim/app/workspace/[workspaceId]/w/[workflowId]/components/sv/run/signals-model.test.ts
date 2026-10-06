/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applySignalUpdates,
  graphSignalPaths,
  parseSignalInput,
  recordingToScenario,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-model'

describe('signals panel model (M08-T08/T09)', () => {
  it('watches the signals the workflow uses', () => {
    const graph = JSON.stringify({
      blocks: [
        { props: { path: 'Vehicle.Speed' } },
        { props: { path: 'Vehicle.Body.Lights.Hazard.IsSignaling' } },
        { props: { path: 'Vehicle.Speed' } },
        { props: { durationMs: 2000 } },
      ],
    })
    expect(graphSignalPaths(graph)).toEqual([
      'Vehicle.Body.Lights.Hazard.IsSignaling',
      'Vehicle.Speed',
    ])
    expect(graphSignalPaths('{bad')).toEqual([])
  })

  it('reads typed input like the scenario editor', () => {
    expect(parseSignalInput('true')).toBe(true)
    expect(parseSignalInput(' 130 ')).toBe(130)
    expect(parseSignalInput('[1, 2]')).toEqual([1, 2])
    expect(parseSignalInput('SLOW')).toBe('SLOW')
    expect(parseSignalInput('')).toBe('')
  })

  it('keeps the latest value and target of each signal', () => {
    let v = applySignalUpdates({}, [{ path: 'A', ts: 1, value: 1, field: 'value' }])
    v = applySignalUpdates(v, [{ path: 'A', ts: 2, value: true, field: 'target' }])
    expect(v.A).toEqual({ value: 1, target: true, ts: 2 })
  })

  it('a recording becomes a scenario v1 with the initial values and timed inputs', () => {
    expect(
      recordingToScenario(
        {
          startedAt: 0,
          initial: { 'Vehicle.Speed': 0 },
          inputs: [
            { t: 1200.4, path: 'Vehicle.Speed', value: 100 },
            { t: 3500, path: 'Vehicle.Speed', value: 130 },
          ],
        },
        'Recorded'
      )
    ).toEqual({
      scenarioVersion: '1.0.0',
      name: 'Recorded',
      until: 6000,
      initial: { 'Vehicle.Speed': 0 },
      inputs: [
        { t: 1200, path: 'Vehicle.Speed', value: 100 },
        { t: 3500, path: 'Vehicle.Speed', value: 130 },
      ],
    })
  })
})
