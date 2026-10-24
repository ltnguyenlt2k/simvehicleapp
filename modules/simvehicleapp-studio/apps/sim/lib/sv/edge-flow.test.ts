/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { edgeFlowState, flowAt } from '@/lib/sv/edge-flow'

const trace = [
  { ev: 'trigger', ts: 1000, blockId: 't', data: { outputs: { value: 100 } } },
  { ev: 'enter', ts: 1000, blockId: 'i' },
  { ev: 'exit', ts: 1000, blockId: 'i', data: { handle: 'else' } },
  { ev: 'trigger', ts: 2000, blockId: 't', data: { outputs: { value: 130 } } },
  { ev: 'enter', ts: 2000, blockId: 'i' },
  { ev: 'exit', ts: 2000, blockId: 'i', data: { handle: 'then' } },
  { ev: 'enter', ts: 2000, blockId: 's' },
  { ev: 'exit', ts: 2001, blockId: 's' },
]

describe('live values on edges (M18-T08)', () => {
  it('at the cursor: the trigger value, the branch taken, the other one skipped', () => {
    const at1 = flowAt(trace, 1500)
    expect(at1.t).toEqual({ value: 100 })
    expect(edgeFlowState(at1.i, 'else')).toBe('taken')
    expect(edgeFlowState(at1.i, 'then')).toBe('skipped')
    expect(edgeFlowState(at1.s, 'source')).toBe('idle')

    const end = flowAt(trace)
    expect(end.t).toEqual({ value: 130 })
    expect(edgeFlowState(end.i, 'then')).toBe('taken')
    expect(edgeFlowState(end.i, 'else')).toBe('skipped')
    expect(edgeFlowState(end.t, 'source')).toBe('taken')
    expect(edgeFlowState(end.s, null)).toBe('taken')
    expect(edgeFlowState(undefined, 'then')).toBe('idle')
  })

  it('a block that ran without choosing a branch leaves its branch edges idle', () => {
    expect(edgeFlowState(flowAt([{ ev: 'exit', ts: 1, blockId: 'w' }]).w, 'timeout')).toBe('idle')
  })
})
