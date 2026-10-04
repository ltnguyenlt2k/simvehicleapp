/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    activeWorkflowId: 'wf-1' as string | null,
    variables: [
      { id: 'v2', workflowId: 'wf-1', name: 'warnActive', type: 'boolean', value: false },
      { id: 'v1', workflowId: 'wf-1', name: 'count', type: 'number', value: 0 },
    ],
  },
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: { getState: () => ({ activeWorkflowId: state.activeWorkflowId }) },
}))
vi.mock('@/stores/variables/store', () => ({
  useVariablesStore: {
    getState: () => ({
      getVariablesByWorkflowId: (id: string) => state.variables.filter((v) => v.workflowId === id),
    }),
  },
}))

import { SV_VEHICLE_BLOCKS } from '@/blocks/vehicle'
import { outputType, subBlockFor, workflowVariableOptions } from '@/blocks/vehicle/factory'

describe('workflow variables (M03-T09)', () => {
  it('lists the open workflow variables, sorted, with their type', async () => {
    expect(await workflowVariableOptions()).toEqual([
      { id: 'count', label: 'count (number)' },
      { id: 'warnActive', label: 'warnActive (boolean)' },
    ])
  })

  it('is empty without an open workflow', async () => {
    state.activeWorkflowId = null
    expect(await workflowVariableOptions()).toEqual([])
    state.activeWorkflowId = 'wf-1'
  })

  it('variable blocks pick the name from the Variables panel', () => {
    for (const type of ['sv_var_get', 'sv_var_set', 'sv_counter']) {
      const name = SV_VEHICLE_BLOCKS[type]!.subBlocks.find((s) => s.id === 'name')!
      expect(name.type).toBe('dropdown')
      expect(name.fetchOptions).toBe(workflowVariableOptions)
    }
  })
})

describe('factory mapping', () => {
  it('maps BlockSpec output types to canvas types', () => {
    expect(['uint32', 'double', 'timestamp'].map(outputType)).toEqual([
      'number',
      'number',
      'number',
    ])
    expect(['$signal', '$inferred', '$element'].map(outputType)).toEqual(['any', 'any', 'any'])
    expect(['boolean', 'string', 'json'].map(outputType)).toEqual(['boolean', 'string', 'json'])
  })

  it('rejects a prop kind without a studio editor', () => {
    expect(() => subBlockFor({ name: 'x', kind: 'mystery', required: false })).toThrow(
      "No studio editor for BlockSpec prop kind 'mystery'"
    )
  })
})
