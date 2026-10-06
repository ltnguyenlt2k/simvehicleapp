/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  defaultScenario,
  parseCell,
  replayAt,
  scenarioFromYaml,
  scenarioToYaml,
  timelineRows,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'

describe('scenario YAML exchange (M05-T09)', () => {
  it('round-trips a scenario and validates against the contract', () => {
    const s = {
      ...defaultScenario('GW-A'),
      until: 8000,
      initial: { 'Vehicle.Speed': 0 },
      inputs: [
        { t: 1000, path: 'Vehicle.Speed', value: 130 },
        { t: 2000, topic: 'vehicle/cmd', value: 'ON' },
      ],
    }
    expect(scenarioFromYaml(scenarioToYaml(s))).toEqual({ ok: true, scenario: s })
  })

  it('reads the golden scenario format and reports the first problem', () => {
    const golden = `scenarioVersion: 1.0.0\nname: GW-A\nuntil: 8000\ninputs:\n  - { t: 1000, path: Vehicle.Speed, value: 100 }   # comment\n`
    expect(scenarioFromYaml(golden)).toMatchObject({
      ok: true,
      scenario: { inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 100 }] },
    })
    expect(scenarioFromYaml('until: [')).toMatchObject({ ok: false })
    expect(
      scenarioFromYaml('scenarioVersion: 1.0.0\nname: x\nuntil: 99999999999\ninputs: []')
    ).toMatchObject({ ok: false, error: expect.stringContaining('until') })
  })

  it('cells parse as JSON when they can, text otherwise', () => {
    expect(parseCell('130')).toBe(130)
    expect(parseCell('true')).toBe(true)
    expect(parseCell('"RED"')).toBe('RED')
    expect(parseCell('RED')).toBe('RED')
    expect(parseCell('[1, 2]')).toEqual([1, 2])
    expect(parseCell('{"a":1}')).toBe('{"a":1}')
  })
})

const trace = [
  { runId: 'r', seq: 0, ts: 1000, wf: 'w', run: 1, node: 'n1', blockId: 'b1', ev: 'trigger' },
  { runId: 'r', seq: 1, ts: 1000, wf: 'w', run: 1, node: 'n2', blockId: 'b2', ev: 'enter' },
  {
    runId: 'r',
    seq: 2,
    ts: 3000,
    wf: 'w',
    run: 1,
    node: 'n2',
    blockId: 'b2',
    ev: 'exit',
    data: { handle: 'stable' },
  },
  { runId: 'r', seq: 3, ts: 3000, wf: 'w', run: 1, node: 'n3', blockId: 'b3', ev: 'enter' },
  {
    runId: 'r',
    seq: 4,
    ts: 3000,
    wf: 'w',
    run: 1,
    node: 'n3',
    blockId: 'b3',
    ev: 'write',
    data: { path: 'Vehicle.X', value: true },
  },
  { runId: 'r', seq: 5, ts: 3000, wf: 'w', run: 1, node: 'n3', blockId: 'b3', ev: 'exit' },
]

describe('timeline and replay (M05-T10)', () => {
  it('replays which block runs at a virtual time', () => {
    expect(replayAt(trace, 500)).toEqual({})
    expect(replayAt(trace, 2000).b2).toEqual({ state: 'running', runs: 0 })
    expect(replayAt(trace, 3000).b2).toEqual({ state: 'done', runs: 1 })
    expect(replayAt(trace, 3000).b3).toEqual({ state: 'done', runs: 1, last: 'true' })
  })

  it('lists inputs, triggers and writes in time order', () => {
    const rows = timelineRows({
      trace,
      writes: [],
      signals: [{ t: 1000, path: 'Vehicle.Speed', value: 130 }],
      publishes: [],
      logs: [],
    })
    expect(rows.map((r) => [r.t, r.kind, r.label])).toEqual([
      [1000, 'input', 'Vehicle.Speed'],
      [1000, 'trigger', 'run 1'],
      [3000, 'write', 'Vehicle.X'],
    ])
  })
})
