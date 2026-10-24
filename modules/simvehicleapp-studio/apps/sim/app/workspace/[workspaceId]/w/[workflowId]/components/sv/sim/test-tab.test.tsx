/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    cases: [] as unknown[],
    graphJson: null as string | null,
    outcomes: {} as Record<string, unknown>,
  },
}))
vi.mock('@/hooks/queries/sv-test-cases', () => ({
  useSvTestCases: () => ({ data: state.cases, isLoading: false }),
  useCreateSvTestCase: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useUpdateSvTestCase: () => ({ mutate: vi.fn() }),
  useDeleteSvTestCase: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/hooks/queries/sv-simulation', () => ({
  useSvScenario: () => ({ data: null, isLoading: false }),
  useSaveSvScenario: () => ({ mutate: vi.fn() }),
  svScenarioKeys: { detail: (id: string) => ['sv-scenario', id] },
}))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ getQueryData: () => null }) }))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow', () => ({
  useWorkflowRuns: () => ({ project: { id: 'p1' }, active: { state: 'running' } }),
}))
vi.mock('@/stores/sv/lint/store', () => ({
  useSvLintStore: (f: (s: unknown) => unknown) => f({ graphJson: state.graphJson }),
}))
// Zustand renders its initial state on the server: the test store is a plain object here.
vi.mock('@/stores/sv/test/store', () => {
  const api = { open: () => {}, setActiveCase: () => {}, setOutcome: () => {}, forget: () => {} }
  const hook = (f: (s: unknown) => unknown) =>
    f({ activeCaseId: null, outcomes: state.outcomes, ...api })
  hook.getState = () => api
  return { useSvTestStore: hook }
})

import { TestTab } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/test-tab'

const graph = JSON.stringify({
  blocks: [
    {
      id: 'b1',
      type: 'sv_on_signal_changed',
      name: 'Speed changed',
      props: { path: 'Vehicle.Speed' },
    },
    { id: 'b2', type: 'sv_if', name: 'Fast', props: { condition: '<Vehicle.Speed> > 120' } },
    { id: 'b3', type: 'sv_set_actuator', name: 'On', props: { path: 'Vehicle.X', value: true } },
    { id: 'b4', type: 'sv_set_actuator', name: 'Off', props: { path: 'Vehicle.X', value: false } },
  ],
  edges: [
    { from: 'b1', fromHandle: 'source', to: 'b2' },
    { from: 'b2', fromHandle: 'then', to: 'b3' },
    { from: 'b2', fromHandle: 'else', to: 'b4' },
  ],
})
const sc = (name: string) => ({ scenarioVersion: '1.1.0', name, until: 1000, inputs: [] })

describe('Test tab (ADR-0058 §4, M18-T04)', () => {
  beforeEach(() => {
    state.outcomes = {}
    state.cases = []
    state.graphJson = graph
  })

  it('empty: Generate tests, Ask the assistant, Record from a live run above the first case editor', () => {
    const html = renderToStaticMarkup(
      <TestTab workflowId='wf' workflowName='LKA' onAskAssistant={() => {}} onRecord={() => {}} />
    )
    expect(html).toContain('data-sv="test-empty"')
    for (const id of ['test-generate', 'test-ask', 'test-record', 'scenario-editor'])
      expect(html).toContain(`data-sv="${id}"`)
  })

  it('cases with their last outcome on this graph, branch coverage from the blocks they entered', () => {
    state.cases = [
      { id: 'tc_1', name: 'Fast', scenario: sc('Fast'), position: 0 },
      { id: 'tc_2', name: 'Slow', scenario: sc('Slow'), position: 1 },
      { id: 'tc_3', name: 'New', scenario: sc('New'), position: 2 },
    ]
    state.outcomes = {
      tc_1: { passed: true, mismatches: [], graphJson: graph, blockIds: ['b2', 'b3'] },
      tc_2: { passed: false, mismatches: ['expected X'], graphJson: graph, blockIds: ['b2'] },
    }
    const html = renderToStaticMarkup(<TestTab workflowId='wf' workflowName='LKA' />)
    expect(html).toContain('data-sv-case="tc_1" data-sv-outcome="passed"')
    expect(html).toContain('data-sv-case="tc_2" data-sv-outcome="failed"')
    expect(html).toContain('data-sv-case="tc_3" data-sv-outcome="none"')
    expect(html).toContain('data-sv="test-play"')
    expect(html).toMatch(/Branches covered: (<!-- -->)?1(<!-- -->)? \/ (<!-- -->)?2/)
  })

  it('an outcome from another graph is stale', () => {
    state.cases = [{ id: 'tc_1', name: 'Fast', scenario: sc('Fast'), position: 0 }]
    state.outcomes = { tc_1: { passed: true, mismatches: [], graphJson: '{}', blockIds: [] } }
    expect(renderToStaticMarkup(<TestTab workflowId='wf' workflowName='LKA' />)).toContain(
      'data-sv-outcome="none"'
    )
  })
})
