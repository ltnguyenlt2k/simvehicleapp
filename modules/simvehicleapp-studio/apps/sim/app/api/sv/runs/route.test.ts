/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCall, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCall: vi.fn(),
  dbState: { rows: [] as unknown[] },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: vi.fn() }))
vi.mock('@/lib/sv/api-client', () => ({
  callSvService: mockCall,
  SvServiceNotConfiguredError: class extends Error {},
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({ loadWorkflowFromNormalizedTables: vi.fn() }))
vi.mock('@sim/db/schema', () => ({
  svProjects: { _: 'sv_projects', id: 'id', workspaceId: 'workspace_id' },
  workflow: { _: 'workflow' },
  svWorkflowSettings: { _: 'sv_workflow_settings' },
  svWorkflowScenarios: { _: 'sv_workflow_scenarios' },
}))
vi.mock('@sim/db', () => ({
  db: { select: () => ({ from: () => ({ where: async () => dbState.rows }) }) },
}))

import { GET } from '@/app/api/sv/runs/route'

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const run = (id: string, projectId: string) => ({
  id,
  projectId,
  generationId: 'g_1',
  state: 'running',
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  expiresAt: 1_800_001,
})
const project = (id: string, name: string) => ({
  id,
  slug: id,
  name,
  appName: name,
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: 'ready',
  workflows: [],
})
const limits = { sandbox: true, perUser: 2, total: 20, maxMinutes: 30, maxExtensions: 3 }

describe('GET /api/sv/runs (My runs, ADR-0057)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it("lists the user's runs with app name and workspace, and the limits", async () => {
    dbState.rows = [{ id: 'p1', workspaceId: 'ws-1' }]
    mockCall
      .mockResolvedValueOnce(reply(200, { runs: [run('r_1', 'p1'), run('r_2', 'gone')], limits }))
      .mockResolvedValueOnce(reply(200, project('p1', 'Lane keeping')))
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(200)
    expect(mockCall.mock.calls[0][1]).toBe('/runs?active=true&ownerUserId=user-1')
    const body = await res.json()
    expect(body.limits).toEqual(limits)
    expect(body.runs).toEqual([
      expect.objectContaining({ id: 'r_1', projectName: 'Lane keeping', workspaceId: 'ws-1' }),
    ])
  })

  it('a stack without limits runs one app at a time', async () => {
    dbState.rows = []
    mockCall.mockResolvedValueOnce(reply(200, { runs: [] }))
    const body = await (await GET(createMockRequest('GET'))).json()
    expect(body).toEqual({
      runs: [],
      limits: { sandbox: false, perUser: 1, total: 1, maxMinutes: 0, maxExtensions: 0 },
    })
  })

  it('needs a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await GET(createMockRequest('GET'))).status).toBe(401)
    expect(mockCall).not.toHaveBeenCalled()
  })
})
