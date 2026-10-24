/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: { open: true, byBlock: {} as Record<string, unknown> },
}))
vi.mock('reactflow', () => ({ useReactFlow: () => ({ fitView: vi.fn() }) }))
vi.mock('@/stores/sv/canvas-view/store', () => {
  const hook = (f: (s: unknown) => unknown) => f({ logicOpen: state.open })
  hook.getState = () => ({ setLogicOpen: () => {} })
  return { useSvCanvasViewStore: hook }
})
vi.mock('@/stores/sv/lint/store', () => ({
  useSvLintStore: (f: (s: unknown) => unknown) => f({ byBlock: state.byBlock }),
}))
vi.mock('@/stores/panel', () => {
  const hook = (f: (s: unknown) => unknown) => f({ currentBlockId: 'i' })
  hook.getState = () => ({ setCurrentBlockId: () => {} })
  return { usePanelEditorStore: hook }
})
const sub = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }]))
vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (f: (s: unknown) => unknown) =>
    f({
      blocks: {
        t: {
          id: 't',
          type: 'sv_on_signal_changed',
          name: 'When Speed changes 1',
          position: { x: 0, y: 0 },
          subBlocks: sub({ path: 'Vehicle.Speed', mode: 'any' }),
        },
        i: {
          id: 'i',
          type: 'sv_if',
          name: 'If 1',
          position: { x: 0, y: 10 },
          subBlocks: sub({ condition: '<Vehicle.Speed> > 120' }),
        },
        a: {
          id: 'a',
          type: 'sv_set_actuator',
          name: 'On',
          position: { x: 0, y: 20 },
          subBlocks: sub({ path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: 'true' }),
        },
      },
      edges: [
        { source: 't', sourceHandle: 'source', target: 'i' },
        { source: 'i', sourceHandle: 'then', target: 'a' },
      ],
      loops: {},
      parallels: {},
    }),
}))

import { SvLogicPanel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/canvas/logic-panel'

describe('Logic view panel (M18-T07)', () => {
  beforeEach(() => {
    state.open = true
    state.byBlock = {}
  })

  it('reads the workflow as sentences, the selected block highlighted, problems in their sentence', () => {
    state.byBlock = { a: { errors: 1, warnings: 0, infos: 0, first: 'value is not a boolean' } }
    const html = renderToStaticMarkup(<SvLogicPanel />)
    expect(html).toContain('data-sv="logic-view"')
    expect(html).toContain('When Speed changes')
    expect(html).toContain('If Speed &gt; 120')
    expect(html).toContain('then ⇒')
    expect(html).toContain('Set Hazard.IsSignaling = true')
    expect(html.match(/data-sv-logic-line="(trigger|step|branch)"/g)).toHaveLength(4)
    expect(html).toContain('✕ value is not a boolean')
  })

  it('renders nothing while closed', () => {
    state.open = false
    expect(renderToStaticMarkup(<SvLogicPanel />)).toBe('')
  })
})
