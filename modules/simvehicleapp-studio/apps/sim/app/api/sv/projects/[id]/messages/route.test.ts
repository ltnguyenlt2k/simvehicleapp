/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, mockProjectOf, mockGraphsFor, mockCallees, mockRelay } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockProjectOf: vi.fn(),
  mockGraphsFor: vi.fn(),
  mockCallees: vi.fn(),
  mockRelay: vi.fn(),
}))

vi.mock('@/lib/sv/projects', () => ({
  authorizeProject: mockAuthorize,
  projectOf: mockProjectOf,
  graphsFor: mockGraphsFor,
}))
vi.mock('@/lib/sv/callees', () => ({ calleesFor: mockCallees }))
vi.mock('@/lib/sv/sse-relay', () => ({ relaySse: mockRelay }))

import { GET } from '@/app/api/sv/projects/[id]/messages/route'

const block = (type: string, topic: string) => ({ id: topic, type, name: topic, props: { topic } })

describe('GET /api/sv/projects/[id]/messages (M18-T05, M21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorize.mockResolvedValue({ row: { id: 'p1', workspaceId: 'ws-1' }, userId: 'user-1' })
    mockProjectOf.mockResolvedValue({
      vssRelease: 'v4.0',
      settings: { mqttTopicPrefix: 'simvehicleapp/overspeed' },
      workflows: [
        { simWorkflowId: 'wf-a', enabled: true },
        { simWorkflowId: 'wf-b', enabled: false },
      ],
    })
    mockGraphsFor.mockResolvedValue({
      graphs: [
        {
          workflowId: 'wf-a',
          blocks: [block('sv_mqtt_publish', 'fleet/telemetry'), block('sv_on_mqtt', 'fleet/+/cmd')],
        },
      ],
      missing: [],
      issues: [],
    })
    mockCallees.mockResolvedValue([
      { workflowId: 'fn', blocks: [block('sv_on_mqtt', 'fleet/cmd')] },
    ])
    mockRelay.mockResolvedValue(new Response(''))
  })

  it("streams the prefix and the exact topics of the app's enabled workflows and the functions they call", async () => {
    await GET(createMockRequest('GET'), { params: Promise.resolve({ id: 'p1' }) })
    expect(mockGraphsFor).toHaveBeenCalledWith('ws-1', ['wf-a'], 'v4.0')
    const path = mockRelay.mock.calls[0][1] as string
    const q = new URLSearchParams(path.split('?')[1])
    expect(q.get('prefix')).toBe('simvehicleapp/overspeed')
    // fleet/+/cmd is a wildcard filter: not subscribed for display.
    expect(q.get('topics')).toBe('fleet/cmd,fleet/telemetry')
  })
})
