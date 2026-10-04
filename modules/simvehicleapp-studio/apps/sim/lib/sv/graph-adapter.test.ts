/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { adaptWorkflow, type SimWorkflowState } from '@/lib/sv/graph-adapter'

const sub = (value: unknown) => ({ id: 'x', type: 'short-input' as const, value })
const block = (
  id: string,
  type: string,
  name: string,
  subBlocks: Record<string, unknown> = {},
  data = {}
) => ({
  id,
  type,
  name,
  position: { x: 0, y: 0 },
  subBlocks: Object.fromEntries(
    Object.entries(subBlocks).map(([k, v]) => [k, { ...sub(v), id: k }])
  ),
  outputs: {},
  enabled: true,
  data,
})

function state(): SimWorkflowState {
  return {
    blocks: {
      start: block('start', 'starter', 'Start') as never,
      note: block('note', 'note', 'Note', { content: 'hi' }) as never,
      b1: block('b1', 'sv_on_signal_changed', 'Speed changed', {
        path: 'Vehicle.Speed',
        mode: 'any',
        threshold: null,
        debounceMs: 0,
        concurrency: 'restart',
      }) as never,
      b2: block('b2', 'sv_set_actuator', 'Hazard on', {
        path: 'Vehicle.Body.Lights.Hazard.IsSignaling',
        value: 'true',
        awaitAck: true,
        onError: 'continue',
      }) as never,
      b3: block('b3', 'sv_mqtt_publish', 'Publish', {
        topic: 't',
        payload: '{"v": <Vehicle.Speed>}',
        payloadType: 'json',
        qos: '1',
        retain: false,
      }) as never,
      b4: block('b4', 'sv_switch', 'Pick', {
        value: '<speedchanged.value>',
        cases: [{ id: 'r1', cells: { when: '10' } }],
      }) as never,
      loop1: block('loop1', 'loop', 'Loop 1', {}, { loopType: 'for', count: 3 }) as never,
      b5: block(
        'b5',
        'sv_log',
        'In loop',
        { level: 'info', message: 'i=<loop.index>' },
        { parentId: 'loop1' }
      ) as never,
      par1: block('par1', 'parallel', 'Parallel 1', {}, { parallelType: 'collection' }) as never,
      b6: block(
        'b6',
        'sv_log',
        'In bad parallel',
        { level: 'info', message: 'x' },
        { parentId: 'par1' }
      ) as never,
    },
    edges: [
      { id: 'e0', source: 'start', target: 'b1', sourceHandle: 'source', targetHandle: 'target' },
      { id: 'e2', source: 'b2', target: 'loop1' },
      { id: 'e1', source: 'b1', target: 'b2', sourceHandle: 'source', targetHandle: 'target' },
      {
        id: 'e3',
        source: 'loop1',
        target: 'b5',
        sourceHandle: 'loop-start-source',
        targetHandle: 'target',
      },
      { id: 'e4', source: 'b4', target: 'b3', sourceHandle: 'case-0', targetHandle: 'target' },
    ],
    loops: { loop1: { id: 'loop1', nodes: ['b5'], iterations: 3, loopType: 'for', enabled: true } },
    parallels: { par1: { id: 'par1', nodes: ['b6'], parallelType: 'collection', enabled: true } },
  }
}

const input = () => ({
  workflowId: 'wf-1',
  name: 'Demo',
  vssRelease: 'v4.2',
  state: state(),
  variables: [
    { id: 'v1', name: 'count', type: 'number' as const, value: '2' },
    { id: 'v2', name: 'warn', type: 'boolean' as const, value: 'true' },
    { id: 'v3', name: 'bad name', type: 'plain' as const, value: 'x' },
    { id: 'v4', name: 'cfg', type: 'object' as const, value: '{"a":1}' },
  ],
})

describe('graph adapter: Sim state → WorkflowGraph (M03-T11, M4 base)', () => {
  it('keeps sv_* blocks and supported containers, drops Start/Note and their edges', () => {
    const { graph } = adaptWorkflow(input())
    expect(graph.blocks.map((b) => [b.id, b.type, b.parentId])).toEqual([
      ['b1', 'sv_on_signal_changed', null],
      ['b2', 'sv_set_actuator', null],
      ['b3', 'sv_mqtt_publish', null],
      ['b4', 'sv_switch', null],
      ['b5', 'sv_log', 'loop1'],
      ['b6', 'sv_log', null],
      ['loop1', 'sv_repeat', null],
    ])
    expect(graph.edges.map((e) => `${e.from}:${e.fromHandle}->${e.to}:${e.toHandle}`)).toEqual([
      'b1:source->b2:target',
      'b2:source->loop1:target',
      'loop1:loop-start-source->b5:target',
      'b4:case-0->b3:target',
    ])
    expect(graph).toMatchObject({
      graphVersion: '1.0.0',
      workflowId: 'wf-1',
      name: 'Demo',
      vss: { release: 'v4.2' },
    })
  })

  it('maps container settings and reports unsupported modes', () => {
    const { graph, issues } = adaptWorkflow(input())
    expect(graph.blocks.find((b) => b.id === 'loop1')!.props).toEqual({ count: 3, intervalMs: 0 })
    expect(issues).toEqual([
      {
        code: 'CONTAINER_INVALID',
        blockId: 'par1',
        message: 'Parallel "each item" is not available for vehicle apps',
      },
      {
        code: 'BLOCK_PROPERTY_INVALID',
        message: "Variable name 'bad name' must use letters, digits and _ only",
      },
    ])
  })

  it('shapes props like the BlockSpec: numeric enums, list rows, nulls kept', () => {
    const { graph } = adaptWorkflow(input())
    const props = (id: string) => graph.blocks.find((b) => b.id === id)!.props
    expect(props('b3')).toMatchObject({ qos: 1, payloadType: 'json', retain: false })
    expect(props('b4').cases).toEqual([{ when: '10' }])
    expect(props('b1')).toEqual({
      path: 'Vehicle.Speed',
      mode: 'any',
      threshold: null,
      debounceMs: 0,
      concurrency: 'restart',
    })
  })

  it('maps Sim variable types', () => {
    expect(adaptWorkflow(input()).graph.variables).toEqual([
      { name: 'cfg', type: 'json', initial: { a: 1 } },
      { name: 'count', type: 'double', initial: 2 },
      { name: 'warn', type: 'boolean', initial: true },
    ])
  })

  it('is deterministic regardless of record/edge order', () => {
    const a = adaptWorkflow(input())
    const shuffled = input()
    shuffled.state.blocks = Object.fromEntries(Object.entries(shuffled.state.blocks).reverse())
    shuffled.state.edges = [...shuffled.state.edges].reverse()
    expect(JSON.stringify(adaptWorkflow(shuffled))).toBe(JSON.stringify(a))
  })

  it('skips disabled blocks', () => {
    const i = input()
    ;(i.state.blocks.b2 as { enabled: boolean }).enabled = false
    expect(adaptWorkflow(i).graph.blocks.map((b) => b.id)).not.toContain('b2')
  })
})
