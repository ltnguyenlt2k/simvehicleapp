/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evalText, type FlowTraceEvent, flowRuns, stepDuration } from '@/lib/sv/flow-trace'

const CONTRACTS = join(__dirname, '../../../../../simvehicleapp-contracts/fixtures/golden')
const golden = (id: string) =>
  JSON.parse(readFileSync(join(CONTRACTS, id, 'expected.trace.json'), 'utf8')) as FlowTraceEvent[]

describe('flow of a workflow (ADR-0062 §1, M19-T03)', () => {
  it('GW-B: each run of the trigger with its steps, the branch taken and why, newest first', () => {
    const { runs, hidden } = flowRuns(golden('GW-B'))
    expect(hidden).toBe(0)
    const summary = runs.map((r) => ({
      run: r.run,
      outcome: r.outcome,
      steps: r.steps.map(
        (s) =>
          `${s.node}${s.handle ? `:${s.handle}` : ''}${s.eval ? ` (${evalText(s.eval)})` : ''}${s.writes.length ? ` writes ${s.writes.length}` : ''}`
      ),
    }))
    expect(summary).toMatchSnapshot()
    expect(runs.every((r) => r.outcome === 'done')).toBe(true)
    // the same trace gives the same flow
    expect(flowRuns(golden('GW-B'))).toEqual(flowRuns(structuredClone(golden('GW-B'))))
  })

  it.each(['GW-A', 'GW-C', 'GW-D', 'GW-E', 'GW-F', 'GW-G'])(
    '%s: every trigger run, steps closed, writes attached',
    (id) => {
      const trace = golden(id)
      const { runs } = flowRuns(trace)
      expect(runs.length).toBe(trace.filter((e) => e.ev === 'trigger').length)
      const writes = runs.flatMap((r) => r.steps.flatMap((s) => s.writes)).length
      expect(writes).toBe(trace.filter((e) => e.ev === 'write').length)
      // a cancelled run (policy restart) may stop inside a waiting block
      for (const r of runs)
        if (r.outcome === 'done') for (const s of r.steps) expect(stepDuration(s)).not.toBeNull()
      expect(runs.every((r) => r.outcome === 'done' || r.outcome === 'cancelled')).toBe(true)
    }
  )

  it('cause, cancel, error, a run still going, sampling and the limit', () => {
    const t: FlowTraceEvent[] = [
      {
        ts: 1000,
        ev: 'trigger',
        wf: 'w',
        run: 1,
        node: 'n1',
        blockId: 'b1',
        data: { outputs: { value: 130 } },
      },
      { ts: 1000, ev: 'enter', wf: 'w', run: 1, node: 'n2', blockId: 'b2' },
      { ts: 1500, ev: 'cancel', wf: 'w', run: 1, node: 'n1', data: { reason: 'restart' } },
      {
        ts: 1500,
        ev: 'trigger',
        wf: 'w',
        run: 2,
        node: 'n1',
        blockId: 'b1',
        data: { outputs: { value: 90 } },
      },
      { ts: 1500, ev: 'enter', wf: 'w', run: 2, node: 'n3', blockId: 'b3' },
      {
        ts: 1501,
        ev: 'error',
        wf: 'w',
        run: 2,
        node: 'n3',
        blockId: 'b3',
        data: { reason: 'write_failed', message: 'refused' },
      },
      {
        ts: 1600,
        ev: 'trigger',
        wf: 'w',
        run: 3,
        node: 'n1',
        blockId: 'b1',
        data: { outputs: { value: 95 } },
      },
      { ts: 1600, ev: 'enter', wf: 'w', run: 3, node: 'n2', blockId: 'b2' },
      {
        ts: 1700,
        ev: 'exit',
        wf: 'w',
        run: 3,
        node: 'n2',
        blockId: 'b2',
        data: { handle: 'else', dropped: 4 },
      },
      { ts: 1700, ev: 'enter', wf: 'w', run: 3, node: 'n4', blockId: 'b4' },
    ]
    const signals = [
      { path: 'Vehicle.Speed', ts: 400, value: 130, source: 'inject' },
      { path: 'Vehicle.Speed', ts: 998, value: 130, source: 'inject' },
      { path: 'Vehicle.Speed', ts: 1499, value: 90, source: 'playback' },
    ]
    const { runs } = flowRuns(t, signals)
    const [r3, r2, r1] = runs
    expect(r1).toMatchObject({
      outcome: 'cancelled',
      cause: { path: 'Vehicle.Speed', ts: 998, source: 'inject' },
    })
    expect(r2).toMatchObject({
      outcome: 'error',
      cause: { source: 'playback' },
      steps: [{ error: { reason: 'write_failed', message: 'refused' } }],
    })
    expect(r3).toMatchObject({
      outcome: 'running',
      steps: [{ handle: 'else', dropped: 4 }, { node: 'n4' }],
    })
    expect(r3?.cause).toBeUndefined()
    expect(flowRuns(t, signals, 2)).toMatchObject({ hidden: 1 })
  })

  it('5000 events in well under 50 ms', () => {
    const t: FlowTraceEvent[] = []
    for (let r = 0; r < 1000; r++) {
      t.push({
        ts: r,
        ev: 'trigger',
        wf: 'w',
        run: r,
        node: 'n1',
        blockId: 'b1',
        data: { outputs: { value: r } },
      })
      t.push({ ts: r, ev: 'enter', wf: 'w', run: r, node: 'n2', blockId: 'b2' })
      t.push({
        ts: r,
        ev: 'exit',
        wf: 'w',
        run: r,
        node: 'n2',
        blockId: 'b2',
        data: { handle: 'then' },
      })
      t.push({ ts: r, ev: 'enter', wf: 'w', run: r, node: 'n3', blockId: 'b3' })
      t.push({ ts: r, ev: 'exit', wf: 'w', run: r, node: 'n3', blockId: 'b3' })
    }
    const t0 = performance.now()
    const { runs, hidden } = flowRuns(t)
    expect(performance.now() - t0).toBeLessThan(50)
    expect([runs.length, hidden]).toEqual([200, 800])
  })
})
