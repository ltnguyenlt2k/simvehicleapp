/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { gradePlayback, observedPaths } from '@/lib/sv/expectations'

const H = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const L = 'Vehicle.ADAS.LaneDepartureDetection.IsEnabled'
const scenario = {
  scenarioVersion: '1.1.0' as const,
  name: 'x',
  until: 5000,
  inputs: [],
  expect: { writes: [{ t: 3000, path: H, value: true }], never: [{ path: L }] },
}

describe('Play on the vehicle stack: grading (ADR-0058 §4/§9)', () => {
  it('observes what the case expects or forbids', () => {
    expect(observedPaths(scenario)).toEqual([L, H].sort())
  })

  it('a write within 300 ms passes and reports its lag; target or current both count', () => {
    expect(
      gradePlayback(scenario, { observed: [{ t: 3042, path: H, field: 'target', value: true }] })
    ).toEqual({
      passed: true,
      mismatches: [],
      drifts: [42],
    })
    expect(
      gradePlayback(scenario, { observed: [{ t: 3100, path: H, field: 'value', value: true }] })
        .passed
    ).toBe(true)
  })

  it('too late, wrong value or a forbidden write fails with what was seen', () => {
    const late = gradePlayback(scenario, {
      observed: [{ t: 3400, path: H, field: 'target', value: true }],
    })
    expect(late.passed).toBe(false)
    expect(late.mismatches[0]).toContain('seen true at 3400 ms')
    expect(gradePlayback(scenario, { observed: [] }).mismatches[0]).toContain('seen nothing')
    const forbidden = gradePlayback(scenario, {
      observed: [
        { t: 3000, path: H, field: 'target', value: true },
        { t: 3500, path: L, field: 'target', value: true },
      ],
    })
    expect(forbidden.mismatches).toEqual([`${L} must not be written: written true at 3500 ms`])
  })
})
