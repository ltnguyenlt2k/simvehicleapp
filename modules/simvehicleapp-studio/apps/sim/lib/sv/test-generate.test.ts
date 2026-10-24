/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { svScenarioSchema } from '@/lib/api/contracts/sv'
import {
  branchCoverage,
  comparisonsOf,
  type Graph,
  generateTests,
  lockExpectations,
  writablePaths,
} from '@/lib/sv/test-generate'

const GOLDEN = join(__dirname, '__golden__')
const graphOf = (id: string) =>
  JSON.parse(readFileSync(join(GOLDEN, id, 'graph.json'), 'utf8')) as Graph

describe('Generate tests (ADR-0058 §10, design M18 §9.4)', () => {
  it('comparisons through VSS paths and trigger outputs, either side', () => {
    const outputs = new Map([['speedchanged', 'Vehicle.Speed']])
    expect(comparisonsOf('<speedchanged.value> > 120', outputs)).toEqual([
      { path: 'Vehicle.Speed', op: '>', value: 120 },
    ])
    expect(comparisonsOf('10 >= <Vehicle.Speed> && <Vehicle.X.Y> == 2.5', outputs)).toEqual([
      { path: 'Vehicle.X.Y', op: '==', value: 2.5 },
      { path: 'Vehicle.Speed', op: '<=', value: 10 },
    ])
    expect(comparisonsOf('<other.value> > 1', outputs)).toEqual([])
  })

  it('GW-A: boundary cases of Stable for (> 120: 121 holds, 120 does not, 121 broken early) and the crossing trigger', () => {
    const cases = generateTests(graphOf('GW-A'))
    expect(cases.map((c) => c.name)).toEqual([
      'Speed > 120: 121 (Stable 2s true)',
      'Speed > 120: 120 (Stable 2s false)',
      'Speed > 120: 121, back to 120 after 1000 ms (Stable 2s broken)',
      'Speed crosses below 110',
    ])
    expect(cases[0].scenario).toEqual({
      scenarioVersion: '1.1.0',
      name: 'Stable 2s',
      until: 5000,
      initial: { 'Vehicle.Speed': 120 },
      inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 121 }],
    })
    expect(cases[3].scenario.initial).toEqual({ 'Vehicle.Speed': 111 })
    expect(cases[3].scenario.inputs).toEqual([{ t: 1000, path: 'Vehicle.Speed', value: 109 }])
  })

  it('every golden: valid scenarios, deterministic (same cases twice)', () => {
    for (const id of readdirSync(GOLDEN).filter((d) => d.startsWith('GW-'))) {
      const a = generateTests(graphOf(id))
      expect(generateTests(graphOf(id))).toEqual(a)
      for (const c of a)
        expect(svScenarioSchema.safeParse(c.scenario).success, `${id} ${c.name}`).toBe(true)
    }
  })

  it('branch coverage counts the branches whose block a case entered', () => {
    const g = graphOf('GW-A')
    expect(branchCoverage(g, []).missing).toEqual([{ from: 'b2', handle: 'stable', to: 'b3' }])
    expect(branchCoverage(g, ['b3']).covered).toHaveLength(1)
  })

  it('locked expectations: writes and publishes as simulated, never for the actuators not written', () => {
    const g = graphOf('GW-A')
    const [c] = generateTests(g)
    const h = 'Vehicle.Body.Lights.Hazard.IsSignaling'
    expect(writablePaths(g)).toEqual([h])
    expect(
      lockExpectations(
        c.scenario,
        { writes: [{ t: 3000, path: h, value: true }] },
        writablePaths(g)
      ).expect
    ).toEqual({
      writes: [{ t: 3000, path: h, value: true }],
    })
    const none = lockExpectations(c.scenario, { writes: [] }, writablePaths(g))
    expect(none.expect).toEqual({ never: [{ path: h }] })
    expect(svScenarioSchema.safeParse(none).success).toBe(true)
  })
})
