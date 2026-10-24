/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SvScenario } from '@/lib/api/contracts/sv'
import { explainFailures } from '@/lib/sv/fail-explain'
import type { FlowTraceEvent } from '@/lib/sv/flow-trace'
import type { Graph } from '@/lib/sv/test-generate'

const DIR = join(__dirname, '../../../../../simvehicleapp-contracts/fixtures/golden/GW-A')
const trace = JSON.parse(readFileSync(join(DIR, 'expected.trace.json'), 'utf8')) as FlowTraceEvent[]
const graph = JSON.parse(readFileSync(join(DIR, 'graph.json'), 'utf8')) as Graph
const HZ = 'Vehicle.Body.Lights.Hazard.IsSignaling'
const scenario = (expect: SvScenario['expect']): SvScenario => ({
  scenarioVersion: '1.1.0',
  name: 'x',
  until: 10_000,
  inputs: [],
  expect,
})

describe('why a test case failed (ADR-0062 §4, M19-T06)', () => {
  it('met expectations explain nothing; a write at another time says when it came', () => {
    expect(
      explainFailures(scenario({ writes: [{ t: 5000, path: HZ, value: true }] }), trace, graph)
    ).toEqual([])
    expect(
      explainFailures(
        scenario({ writes: [{ t: 3000, path: HZ, value: true, within: 300 }] }),
        trace,
        graph
      )
    ).toEqual([
      {
        expected: `${HZ} = true at 3000 ms (within 300 ms)`,
        why: 'written at 5000 ms instead (run 3)',
        blockId: 'b3',
        run: 3,
      },
    ])
  })

  it('the first decision that went the other way, with the values it decided on, and the branch it needs', () => {
    const early = trace.filter((e) => e.ts < 2000)
    expect(
      explainFailures(
        scenario({ writes: [{ t: 1000, path: HZ, value: true, within: 500 }] }),
        early,
        graph
      )
    ).toEqual([
      {
        expected: `${HZ} = true at 1000 ms (within 500 ms)`,
        why: 'Stable 2s took broken (n1.value = 100 ⇒ false); it needs stable',
        blockId: 'b2',
        run: 1,
      },
    ])
  })

  it('a run cancelled while it waited; a trigger that never fired; a never broken', () => {
    // up to the cancel of run 2 at 3000 ms (run 3 has not started)
    const upTo = trace.filter((e) => e.ts < 3000 || (e.ts === 3000 && e.ev === 'cancel'))
    const [cancelled] = explainFailures(
      scenario({ writes: [{ t: 2500, path: HZ, value: true }] }),
      upTo,
      graph
    )
    expect(cancelled?.why).toBe(
      'Stable 2s was waiting when run 2 was cancelled (a newer change restarted it)'
    )
    const noWrite = trace.filter((e) => e.ts < 5000)
    expect(
      explainFailures(scenario({ writes: [{ t: 500, path: HZ, value: true }] }), noWrite, graph)[0]
        ?.why
    ).toBe('Speed changed did not fire before 500 ms')
    const [never] = explainFailures(
      scenario({ never: [{ path: HZ, from: 4000, to: 5500 }] }),
      trace,
      graph
    )
    expect(never).toEqual({
      expected: `never ${HZ} between 4000 and 5500 ms`,
      why: 'Hazard on wrote true at 5000 ms in run 3: Stable 2s → stable (n1.value = 135 ⇒ true)',
      blockId: 'b3',
      run: 3,
    })
  })

  it('no block writes the path', () => {
    expect(
      explainFailures(
        scenario({ writes: [{ t: 1, path: 'Vehicle.Cabin.Light.IsDomeOn', value: true }] }),
        trace,
        graph
      )[0]?.why
    ).toBe('no block writes Vehicle.Cabin.Light.IsDomeOn')
  })
})
