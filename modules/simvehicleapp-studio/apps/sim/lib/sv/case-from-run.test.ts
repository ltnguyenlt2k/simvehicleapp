/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { type SvScenario, svScenarioSchema } from '@/lib/api/contracts/sv'
import { caseFromLiveRun, caseFromSimulatedRun, writablePaths } from '@/lib/sv/case-from-run'
import { type FlowTraceEvent, flowRuns } from '@/lib/sv/flow-trace'
import type { Graph } from '@/lib/sv/test-generate'

const DIR = join(__dirname, '../../../../../simvehicleapp-contracts/fixtures/golden/GW-A')
const trace = JSON.parse(readFileSync(join(DIR, 'expected.trace.json'), 'utf8')) as FlowTraceEvent[]
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as Graph
const scenario = yaml.load(readFileSync(join(DIR, 'scenario.yaml'), 'utf8')) as SvScenario
const HZ = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const writes = trace.flatMap((e) =>
  e.ev === 'write' ? [{ ts: e.ts, path: String(e.data?.path), value: e.data?.value }] : []
)
const run = (n: number) => flowRuns(trace).runs.find((r) => r.run === n)!

describe('test case from a run (ADR-0062 §4, M19-T06)', () => {
  it('a simulated run: the inputs up to its end, its writes within 300 ms, a valid scenario 1.1', () => {
    const writable = writablePaths(graph.blocks)
    expect(writable).toEqual([HZ])
    const c = caseFromSimulatedRun(scenario, run(3), writes, writable, 'Stable overspeed')
    expect(svScenarioSchema.parse(c)).toEqual(c)
    expect(c.until).toBe(6000)
    expect(c.inputs.every((i) => i.t <= 5000)).toBe(true)
    expect(c.expect).toEqual({ writes: [{ t: 5000, path: HZ, value: true, within: 300 }] })
  })

  it('a run that wrote nothing locks that: never the actuators until the end', () => {
    const c = caseFromSimulatedRun(scenario, run(1), writes, [HZ], 'No hazard')
    expect(svScenarioSchema.parse(c)).toEqual(c)
    expect(c.expect).toEqual({ never: [{ path: HZ, to: 2000 }] })
  })

  it('a live run: the signals before it as initial, its cause at 1 s, its writes on the case clock', () => {
    const live = flowRuns(
      [
        {
          ts: 50_000,
          ev: 'trigger',
          wf: 'w',
          run: 7,
          node: 'n1',
          blockId: 'b1',
          data: { outputs: { value: 130 } },
        },
        { ts: 50_000, ev: 'enter', wf: 'w', run: 7, node: 'n3', blockId: 'b3' },
        {
          ts: 50_020,
          ev: 'write',
          wf: 'w',
          run: 7,
          node: 'n3',
          blockId: 'b3',
          data: { path: HZ, value: true },
        },
        {
          ts: 50_030,
          ev: 'exit',
          wf: 'w',
          run: 7,
          node: 'n3',
          blockId: 'b3',
          data: { handle: 'next' },
        },
      ],
      [
        { path: 'Vehicle.Speed', ts: 40_000, value: 100, field: 'value' },
        { path: HZ, ts: 41_000, value: false, field: 'value' },
        { path: HZ, ts: 41_000, value: false, field: 'target' },
        { path: 'Vehicle.Speed', ts: 49_990, value: 130, field: 'value', source: 'inject' },
        { path: HZ, ts: 50_025, value: true, field: 'value', source: 'app' },
      ]
    ).runs[0]!
    const c = caseFromLiveRun(
      live,
      [
        { path: 'Vehicle.Speed', ts: 40_000, value: 100, field: 'value' },
        { path: HZ, ts: 41_000, value: false, field: 'value' },
        { path: HZ, ts: 41_000, value: false, field: 'target' },
        { path: 'Vehicle.Speed', ts: 49_990, value: 130, field: 'value', source: 'inject' },
        { path: HZ, ts: 50_025, value: true, field: 'value', source: 'app' },
      ],
      [HZ],
      'From live run 7'
    )
    expect(svScenarioSchema.parse(c)).toEqual(c)
    expect(c).toMatchObject({
      initial: { 'Vehicle.Speed': 100, [HZ]: false },
      inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 130 }],
      expect: { writes: [{ t: 1030, path: HZ, value: true, within: 300 }] },
      until: 3000,
    })
  })
})
