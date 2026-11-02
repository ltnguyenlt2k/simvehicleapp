/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { adaptRobotWorkflow, isRobotWorkflow } from '@/lib/sv/robotics/robot-graph-adapter'
import { SV_ROBOT_BLOCKS } from '@/blocks/robot'

const blocks = {
  b: { id: 'b', type: 'rf_perform', name: 'Cúi chào', subBlocks: { name: { value: 'BOW' } } },
  a: { id: 'a', type: 'rf_on_start', name: 'Khi bắt đầu', subBlocks: {} },
  m: {
    id: 'm',
    type: 'rf_move',
    name: 'Đi thẳng',
    subBlocks: { linear: { value: '0,3' }, angular: { value: '0' }, durationMs: { value: '' } },
  },
  n: { id: 'n', type: 'note', name: 'Ghi chú' },
}
const edges = [
  { id: 'e2', source: 'b', target: 'm', sourceHandle: 'ok' },
  { id: 'e1', source: 'a', target: 'b', sourceHandle: 'next' },
]

describe('robot graph adapter (ADR-0068 §3)', () => {
  it('keeps ids, port names and labels; types values from the registry; sorted output', () => {
    const { workflow, issues } = adaptRobotWorkflow({
      workflowId: 'w',
      name: 'Demo',
      blocks,
      edges,
    })
    expect(issues).toEqual([])
    expect(workflow.nodes.map((n) => n.id)).toEqual(['a', 'b', 'm'])
    expect(workflow.nodes[1]).toEqual({
      id: 'b',
      block: 'rf.perform',
      label: 'Cúi chào',
      props: { name: 'BOW' },
    })
    expect(workflow.nodes[2].props).toEqual({ linear: 0.3, angular: 0, durationMs: '' })
    expect(workflow.edges).toEqual([
      { from: ['a', 'next'], to: ['b', 'in'] },
      { from: ['b', 'ok'], to: ['m', 'in'] },
    ])
    expect(workflow.profile).toBe('dog-go2-sim')
  })

  it('is deterministic for the same canvas', () => {
    const one = JSON.stringify(adaptRobotWorkflow({ workflowId: 'w', name: 'Demo', blocks, edges }))
    const two = JSON.stringify(
      adaptRobotWorkflow({ workflowId: 'w', name: 'Demo', blocks, edges: [...edges].reverse() })
    )
    expect(one).toBe(two)
  })

  it('rejects vehicle blocks and unnamed outputs', () => {
    const mixed = { ...blocks, v: { id: 'v', type: 'sv_read_signal', name: 'Speed' } }
    const { issues } = adaptRobotWorkflow({
      workflowId: 'w',
      name: 'x',
      blocks: mixed,
      edges: [...edges, { id: 'e3', source: 'a', target: 'm', sourceHandle: null }],
    })
    expect(issues.map((i) => i.code).sort()).toEqual(['RF1001', 'RF1005'])
  })

  it('detects robot workflows and offers every registry block with named handles', () => {
    expect(isRobotWorkflow(blocks)).toBe(true)
    expect(isRobotWorkflow({ x: { type: 'sv_read_signal' } })).toBe(false)
    expect(Object.keys(SV_ROBOT_BLOCKS)).toHaveLength(17)
    expect(SV_ROBOT_BLOCKS.rf_if.svHandles).toEqual([
      { id: 'then', label: 'then' },
      { id: 'else', label: 'else' },
    ])
    expect(SV_ROBOT_BLOCKS.rf_on_start.category).toBe('triggers')
  })
})
