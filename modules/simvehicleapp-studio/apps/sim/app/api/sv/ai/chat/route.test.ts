/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAuthz, mockCall, mockProjectOf, mockGraphsFor, dbState } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockAuthz: vi.fn(),
    mockCall: vi.fn(),
    mockProjectOf: vi.fn(),
    mockGraphsFor: vi.fn(),
    dbState: { rows: [] as unknown[] },
  })
)

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@sim/platform-authz/workflow', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthz,
}))
vi.mock('@/lib/sv/api-client', () => ({
  callSvService: mockCall,
  SvServiceNotConfiguredError: class extends Error {},
}))
vi.mock('@/lib/sv/projects', () => ({
  projectOf: mockProjectOf,
  graphsFor: mockGraphsFor,
  scenariosFor: async () => [],
}))
vi.mock('@sim/db/schema', () => ({ svProjects: { id: 'id' } }))
vi.mock('@sim/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => dbState.rows }) }) }),
  },
}))

import { POST } from '@/app/api/sv/ai/chat/route'

const WF = 'wf-1'
const graph = {
  graphVersion: '1.0.0',
  workflowId: WF,
  name: 'Comfort',
  vss: { release: 'v4.0' },
  blocks: [],
  edges: [],
}
const sse = () =>
  new Response('event: done\ndata: {"conversationId":"c_1","pending":false,"steps":1}\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })

describe('POST /api/sv/ai/chat (M10-T08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.rows = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthz.mockResolvedValue({ allowed: true, workflow: { id: WF, workspaceId: 'ws-1' } })
    mockCall.mockResolvedValue(sse())
  })

  it('401 without a session; 403 without write access to the workflow', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    expect(
      (await POST(createMockRequest('POST', { workflowId: WF, graph, message: 'hi' }))).status
    ).toBe(401)
    mockAuthz.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'no',
      workflow: { id: WF },
    })
    expect(
      (await POST(createMockRequest('POST', { workflowId: WF, graph, message: 'hi' }))).status
    ).toBe(403)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('400 when the graph is not the open workflow (or has no VSS release)', async () => {
    const other = { ...graph, workflowId: 'wf-2' }
    expect(
      (await POST(createMockRequest('POST', { workflowId: WF, graph: other, message: 'hi' })))
        .status
    ).toBe(400)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('relays the turn with the user and the editor context; the browser gets the SSE stream', async () => {
    const res = await POST(
      createMockRequest('POST', {
        workflowId: WF,
        graph,
        message: 'Add a log',
        conversationId: 'c_1',
      })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(await res.text()).toContain('event: done')
    const [service, path, init] = mockCall.mock.calls[0]
    expect([service, path, init.method]).toEqual(['ai-assistant', '/chat', 'POST'])
    expect(init.headers['x-sv-user-id']).toBe('user-1')
    expect(init.body).toEqual({
      message: 'Add a log',
      conversationId: 'c_1',
      context: { workflow: { workflowId: WF, name: 'Comfort', vssRelease: 'v4.0', graph } },
    })
  })

  it('adds the project (same workspace, workflow enabled) with every enabled graph', async () => {
    dbState.rows = [{ id: 'p1', slug: 'comfort', workspaceId: 'ws-1' }]
    mockProjectOf.mockResolvedValue({
      id: 'p1',
      vssRelease: 'v4.0',
      workflows: [
        { simWorkflowId: WF, enabled: true },
        { simWorkflowId: 'wf-3', enabled: true },
      ],
    })
    mockGraphsFor.mockResolvedValue({
      graphs: [graph, { workflowId: 'wf-3' }],
      missing: [],
      issues: [],
    })
    await POST(
      createMockRequest('POST', { workflowId: WF, graph, message: 'Run it', projectId: 'p1' })
    )
    expect(mockGraphsFor).toHaveBeenCalledWith('ws-1', [WF, 'wf-3'], 'v4.0', {
      workflowId: WF,
      graph,
    })
    expect(mockCall.mock.calls[0][2].body.context.project).toEqual({
      id: 'p1',
      vssRelease: 'v4.0',
      graphs: [graph, { workflowId: 'wf-3' }],
      scenarios: [],
    })
    // A project of another workspace is not found.
    dbState.rows = [{ id: 'p9', slug: 'x', workspaceId: 'ws-9' }]
    expect(
      (
        await POST(
          createMockRequest('POST', { workflowId: WF, graph, message: 'x', projectId: 'p9' })
        )
      ).status
    ).toBe(404)
  })

  it('upstream refusals reach the browser as they are (license, rate limit, pending action)', async () => {
    for (const [status, error] of [
      [403, 'not_entitled'],
      [429, 'rate_limited'],
      [409, 'pending_action'],
    ] as const) {
      mockCall.mockResolvedValueOnce(
        new Response(JSON.stringify({ error, message: `upstream ${error}` }), { status })
      )
      const res = await POST(createMockRequest('POST', { workflowId: WF, graph, message: 'hi' }))
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual({ error: `upstream ${error}`, code: error })
    }
  })
})
