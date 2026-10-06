/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { planConvertFix } from '@/lib/sv/quick-fix'

const block = (id: string, name: string, x = 600, data: Record<string, unknown> = {}) =>
  ({
    id,
    type: 'sv_set_actuator',
    name,
    position: { x, y: 200 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    data,
  }) as never

describe('planConvertFix (M04-T11 quick-fix for TYPE_NARROWING_REQUIRES_CAST)', () => {
  let n = 0
  const ids = () => `e${++n}`

  it('puts a Convert on every incoming connection and reads its result', () => {
    n = 0
    const plan = planConvertFix({
      blocks: {
        t: block('t', 'When Speed changes', 200),
        s: block('s', 'Set fan'),
        c1: block('c1', 'Convert 1', 0),
      },
      edges: [
        { id: 'in1', source: 't', target: 's', sourceHandle: 'source', targetHandle: 'target' },
        { id: 'in2', source: 'x', target: 's', sourceHandle: 'then', targetHandle: 'target' },
        { id: 'out', source: 's', target: 'z', sourceHandle: 'source', targetHandle: 'target' },
      ],
      blockId: 's',
      field: 'value',
      to: 'uint8',
      expression: '<whenspeedchanges.value> / 2',
      newBlockId: 'conv',
      newEdgeId: ids,
    })
    expect(plan).toEqual({
      block: { id: 'conv', type: 'sv_convert', name: 'Convert 2', position: { x: 280, y: 200 } },
      values: { value: '<whenspeedchanges.value> / 2', to: 'uint8' },
      removeEdgeIds: ['in1', 'in2'],
      addEdges: [
        { id: 'e1', source: 't', target: 'conv', sourceHandle: 'source', targetHandle: 'target' },
        { id: 'e2', source: 'x', target: 'conv', sourceHandle: 'then', targetHandle: 'target' },
        { id: 'e3', source: 'conv', target: 's', sourceHandle: 'source', targetHandle: 'target' },
      ],
      field: { blockId: 's', subBlockId: 'value', value: '<convert2.result>' },
    })
  })

  it('keeps the Convert in the same container and needs an expression', () => {
    const blocks = { s: block('s', 'Set fan', 300, { parentId: 'loop1', extent: 'parent' }) }
    const plan = planConvertFix({
      blocks,
      edges: [],
      blockId: 's',
      field: 'value',
      to: 'uint8',
      expression: '<loop.index> * 2',
      newBlockId: 'c',
      newEdgeId: () => 'e',
    })
    expect(plan?.block.parentId).toBe('loop1')
    expect(plan?.removeEdgeIds).toEqual([])
    expect(plan?.addEdges).toEqual([
      { id: 'e', source: 'c', target: 's', sourceHandle: 'source', targetHandle: 'target' },
    ])
    expect(
      planConvertFix({
        blocks,
        edges: [],
        blockId: 's',
        field: 'value',
        to: 'uint8',
        expression: '  ',
        newBlockId: 'c',
        newEdgeId: () => 'e',
      })
    ).toBeNull()
    expect(
      planConvertFix({
        blocks,
        edges: [],
        blockId: 'nope',
        field: 'value',
        to: 'uint8',
        expression: '1',
        newBlockId: 'c',
        newEdgeId: () => 'e',
      })
    ).toBeNull()
  })
})
