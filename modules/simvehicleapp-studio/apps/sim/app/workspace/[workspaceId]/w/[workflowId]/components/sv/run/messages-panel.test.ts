/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow', () => ({
  useWorkflowRuns: () => ({}),
}))

import { hmiOf } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/messages-panel'

describe('Messages (M18-T05)', () => {
  it('an HMI notification is the JSON on <prefix>/hmi; anything else is a plain publish', () => {
    expect(
      hmiOf({
        topic: 'sv/lka/hmi',
        payload: '{"title":"Overspeed","severity":"warning","message":"130 km/h"}',
        ts: 1,
      })
    ).toEqual({
      title: 'Overspeed',
      severity: 'warning',
      message: '130 km/h',
    })
    expect(hmiOf({ topic: 'sv/lka/hmi', payload: 'not json', ts: 1 })).toBeNull()
    expect(hmiOf({ topic: 'sv/lka/speed', payload: '{"title":"x"}', ts: 1 })).toBeNull()
  })
})
