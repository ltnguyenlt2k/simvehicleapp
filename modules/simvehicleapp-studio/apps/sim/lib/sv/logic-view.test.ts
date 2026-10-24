/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type LogicState, logicText, logicView } from '@/lib/sv/logic-view'

const GOLDEN = join(__dirname, '__golden__')
const golden = (id: string) =>
  (JSON.parse(readFileSync(join(GOLDEN, id, 'sim-state.json'), 'utf8')) as { state: LogicState })
    .state

const block = (
  id: string,
  type: string,
  name: string,
  values: Record<string, unknown> = {},
  y = 0,
  extra: Partial<LogicState['blocks'][string]> = {}
) => ({
  id,
  type,
  name,
  position: { x: 0, y },
  subBlocks: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])),
  ...extra,
})

describe('logic view (M18-T07, ADR-0059 §2)', () => {
  it.each(['GW-A', 'GW-B', 'GW-C', 'GW-D', 'GW-E', 'GW-F', 'GW-G'])(
    '%s reads as sentences, the same every time',
    (id) => {
      const state = golden(id)
      const text = logicText(logicView(state))
      expect(logicText(logicView(structuredClone(state)))).toBe(text)
      expect(text).toMatchSnapshot()
      // Every enabled block appears once (refs aside).
      const lines = logicView(state).flatMap((p) =>
        p.lines.filter((l) => l.kind !== 'branch' && l.kind !== 'ref')
      )
      const enabled = Object.values(state.blocks).filter((b) => b.enabled !== false)
      expect(new Set(lines.map((l) => l.blockId))).toEqual(new Set(enabled.map((b) => b.id)))
    }
  )

  it('GW-A: trigger, then the Stable for branch with its actions nested under "stable"', () => {
    expect(logicText(logicView(golden('GW-A')))).toMatch(
      /^When .+:\n {2}If .+ holds for 2 s\n {4}stable ⇒\n {6}Set /
    )
  })

  it('branches in reading order, a join shown once then referenced, unreachable and disabled blocks', () => {
    const state: LogicState = {
      blocks: {
        t: block('t', 'sv_on_signal_changed', 'When Speed changes 1', {
          path: 'Vehicle.Speed',
          mode: 'any',
        }),
        i: block('i', 'sv_if', 'If 1', { condition: '<Vehicle.Speed> > 120' }, 10),
        a: block(
          'a',
          'sv_set_actuator',
          'On',
          { path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: 'true' },
          20
        ),
        b: block(
          'b',
          'sv_set_actuator',
          'Off',
          { path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: 'false' },
          30
        ),
        j: block('j', 'sv_log', 'Log', { level: 'info', message: 'done' }, 40),
        u: block('u', 'sv_log', 'Lost', { level: 'warn', message: 'never' }, 50),
        d: block('d', 'sv_log', 'Disabled', {}, 60, { enabled: false }),
      },
      edges: [
        { source: 't', sourceHandle: 'source', target: 'i' },
        { source: 'i', sourceHandle: 'else', target: 'b' },
        { source: 'i', sourceHandle: 'then', target: 'a' },
        { source: 'a', sourceHandle: 'source', target: 'j' },
        { source: 'b', sourceHandle: 'source', target: 'j' },
        { source: 't', sourceHandle: 'source', target: 'd' },
      ],
    }
    expect(logicText(logicView(state))).toBe(
      [
        'When Speed changes:',
        '  If Speed > 120',
        '    then ⇒',
        '      Set Hazard.IsSignaling = true',
        '      Log info: done',
        '    else ⇒',
        '      Set Hazard.IsSignaling = false',
        '      ↺ continues at "Log"',
        '',
        'Not run by any trigger:',
        'Log warn: never',
      ].join('\n')
    )
  })

  it('a cycle ends with a reference instead of looping forever', () => {
    const state: LogicState = {
      blocks: {
        t: block('t', 'sv_on_app_start', 'Start'),
        w: block('w', 'sv_wait', 'Wait', { durationMs: 1000 }, 10),
        l: block('l', 'sv_log', 'Log', { level: 'info', message: 'tick' }, 20),
      },
      edges: [
        { source: 't', target: 'w' },
        { source: 'w', target: 'l' },
        { source: 'l', target: 'w' },
      ],
    }
    expect(logicText(logicView(state))).toBe(
      ['When the app starts:', '  Wait 1 s', '  Log info: tick', '  ↺ continues at "Wait"'].join(
        '\n'
      )
    )
  })
})
