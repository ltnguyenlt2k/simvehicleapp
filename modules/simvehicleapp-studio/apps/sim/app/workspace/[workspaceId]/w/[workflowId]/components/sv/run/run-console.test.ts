/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { SvTraceEvent } from '@/lib/api/contracts/sv'
import {
  consoleRows,
  entryText,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-console'
import type { SvRunEntry } from '@/stores/sv/run/store'

const names: Record<string, string> = {
  b1: 'When Speed changes',
  b2: 'If over 120',
  b3: 'Set Hazard',
}
const name = (id: string) => names[id]
const trace = (seq: number, e: Partial<SvTraceEvent>): SvRunEntry => ({
  kind: 'trace',
  seq,
  ts: seq * 10,
  level: e.ev === 'error' ? 'error' : 'debug',
  event: { runId: 'r', seq, ts: seq * 10, wf: 'w', run: 2, ev: 'enter', ...e } as SvTraceEvent,
})

describe('Run console lines (M19-T05)', () => {
  it('trace events read as sentences; Raw keeps the event', () => {
    const lines = [
      trace(1, { ev: 'trigger', node: 'n1', blockId: 'b1', data: { outputs: { value: 130 } } }),
      trace(2, { ev: 'enter', node: 'n2', blockId: 'b2' }),
      trace(3, {
        ev: 'exit',
        node: 'n2',
        blockId: 'b2',
        data: { handle: 'then', eval: { refs: { 'Vehicle.Speed': 130 }, result: true } },
      }),
      trace(4, {
        ev: 'write',
        node: 'n3',
        blockId: 'b3',
        data: { path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: true },
      }),
      trace(5, {
        ev: 'value',
        node: 'n3',
        blockId: 'b3',
        data: { kind: 'mqtt', topic: 'app/hmi', payload: '{"a":1}' },
      }),
      trace(6, {
        ev: 'error',
        node: 'n3',
        blockId: 'b3',
        data: { reason: 'write_failed', message: 'refused' },
      }),
      trace(7, { ev: 'cancel', node: 'n1', blockId: 'b1', data: { reason: 'restart' } }),
      trace(8, { ev: 'exit', node: 'n3', blockId: 'b3', data: { handle: 'next' } }),
    ].map((e) => entryText(e, name))
    expect(lines).toEqual([
      '▶ When Speed changes fired (run 2) with 130',
      '  → If over 120',
      '  ← If over 120 → then (Speed = 130 ⇒ true)',
      '  Set Hazard writes Vehicle.Body.Lights.Hazard.IsSignaling = true',
      '  Set Hazard publishes app/hmi: {"a":1}',
      '✖ Set Hazard failed (run 2): write_failed — refused',
      '  When Speed changes cancelled (run 2) (restart)',
      '  ← Set Hazard done',
    ])
    expect(entryText(trace(2, { ev: 'enter', node: 'n2', blockId: 'b2' }), name, true)).toBe(
      '▸ n2 enter · If over 120'
    )
  })

  it('injected and played values become input lines in time order; app and vehicle changes do not', () => {
    const entries = [
      trace(1, { node: 'n2', blockId: 'b2' }),
      trace(3, { node: 'n2', blockId: 'b2' }),
    ]
    const rows = consoleRows(entries, [
      { path: 'Vehicle.Speed', ts: 10, value: 130, field: 'value', source: 'inject' },
      { path: 'Vehicle.Speed', ts: 20, value: 90, field: 'value', source: 'playback' },
      {
        path: 'Vehicle.Body.Lights.Hazard.IsSignaling',
        ts: 25,
        value: true,
        field: 'target',
        source: 'app',
      },
      { path: 'Vehicle.Speed', ts: 40, value: 95, field: 'value', source: 'vehicle' },
    ])
    expect(rows.map((r) => r.kind)).toEqual(['input', 'trace', 'input', 'trace'])
    expect(entryText(rows[0] as never)).toBe('● Vehicle.Speed = 130 — you injected')
    expect(entryText(rows[2] as never)).toBe('● Vehicle.Speed = 90 — test playback')
    expect(consoleRows(entries, [])).toEqual(entries)
  })
})
