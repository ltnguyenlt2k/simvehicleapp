/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/sv-runs', () => ({ usePlaySvScenario: vi.fn(), useSetSvSignal: vi.fn() }))
vi.mock('@/hooks/queries/sv-catalog', () => ({
  useSvCatalogNodes: vi.fn(),
  useSvCatalogSearch: vi.fn(),
}))
vi.mock('@/hooks/queries/sv-simulation', () => ({ useSvScenario: vi.fn() }))
vi.mock('@/hooks/queries/sv-test-cases', () => ({ useCreateSvTestCase: vi.fn() }))
vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow', () => ({
  useWorkflowRuns: vi.fn(),
}))

import { droppedSignalPath } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-panel'

describe('drag a signal from the Vehicle panel into Live (M18-T05)', () => {
  it('reads the dragged VSS path; anything else is ignored', () => {
    expect(
      droppedSignalPath(JSON.stringify({ type: 'sv_signal', svSignal: { path: 'Vehicle.Speed' } }))
    ).toBe('Vehicle.Speed')
    expect(
      droppedSignalPath(JSON.stringify({ type: 'block', svSignal: { path: 'Vehicle.Speed' } }))
    ).toBeNull()
    expect(
      droppedSignalPath(JSON.stringify({ type: 'sv_signal', svSignal: { path: 'speed' } }))
    ).toBeNull()
    expect(droppedSignalPath('not json')).toBeNull()
  })
})
