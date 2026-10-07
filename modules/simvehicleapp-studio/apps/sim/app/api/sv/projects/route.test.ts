/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAccess, mockCall, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAccess: vi.fn(),
  mockCall: vi.fn(),
  dbState: {
    tables: {} as Record<string, unknown[]>,
    inserts: [] as { table: string; values: unknown }[],
  },
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/workspaces/permissions/utils', () => ({ checkWorkspaceAccess: mockAccess }))
vi.mock('@/lib/sv/api-client', () => ({
  callSvService: mockCall,
  SvServiceNotConfiguredError: class extends Error {},
}))
vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: vi.fn(),
}))
vi.mock('@sim/db/schema', () => ({
  svProjects: { _: 'sv_projects', id: 'id', workspaceId: 'workspace_id' },
  workflow: { _: 'workflow', id: 'id', workspaceId: 'workspace_id' },
  svWorkflowSettings: { _: 'sv_workflow_settings' },
  svWorkflowScenarios: { _: 'sv_workflow_scenarios' },
}))
vi.mock('@sim/db', () => {
  const rowsOf = (table: { _: string }) => dbState.tables[table._] ?? []
  const select = () => ({
    from: (table: { _: string }) => ({
      where: () => {
        const rows = rowsOf(table)
        return { limit: async () => rows, then: (f: (r: unknown[]) => unknown) => f(rows) }
      },
    }),
  })
  const insert = (table: { _: string }) => ({
    values: async (values: unknown) => {
      dbState.inserts.push({ table: table._, values })
    },
  })
  return { db: { select, insert } }
})

import { GET, POST } from '@/app/api/sv/projects/route'

const WS = 'ws-1'
const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  slug: `app-${id}`,
  name: `App ${id}`,
  appName: 'App',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'trigger' },
  status: 'creating',
  workflows: [],
  ...extra,
})
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('/api/sv/projects (M07-T17)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.tables = {}
    dbState.inserts = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
  })

  it('requires a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(
      createMockRequest('GET', undefined, {}, `http://localhost/api/sv/projects?workspaceId=${WS}`)
    )
    expect(res.status).toBe(401)
  })

  it('lists only the orchestrator projects linked to the workspace', async () => {
    dbState.tables.sv_projects = [{ id: 'p1' }]
    mockCall.mockResolvedValue(reply(200, { projects: [project('p1'), project('p2')] }))
    const res = await GET(
      createMockRequest('GET', undefined, {}, `http://localhost/api/sv/projects?workspaceId=${WS}`)
    )
    expect(res.status).toBe(200)
    expect((await res.json()).projects.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })

  it('hides the projects of a workspace the user cannot access', async () => {
    mockAccess.mockResolvedValue({ exists: true, hasAccess: false, canWrite: false })
    const res = await GET(
      createMockRequest('GET', undefined, {}, `http://localhost/api/sv/projects?workspaceId=${WS}`)
    )
    expect(res.status).toBe(404)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('creates a C++ project, links it and assigns only workflows of the workspace', async () => {
    dbState.tables.workflow = [{ id: 'wf-1' }]
    mockCall
      .mockResolvedValueOnce(reply(201, project('p1')))
      .mockResolvedValueOnce(
        reply(200, project('p1', { workflows: [{ simWorkflowId: 'wf-1', enabled: true }] }))
      )
    const res = await POST(
      createMockRequest('POST', {
        workspaceId: WS,
        name: 'Hazard',
        slug: 'hazard',
        vssRelease: 'v4.0',
        workflowIds: ['wf-1', 'wf-other'],
      })
    )
    expect(res.status).toBe(200)
    expect(mockCall.mock.calls[0][1]).toBe('/projects')
    expect(mockCall.mock.calls[0][2].body).toEqual({
      slug: 'hazard',
      name: 'Hazard',
      language: 'cpp',
      vssRelease: 'v4.0',
    })
    expect(dbState.inserts).toEqual([
      {
        table: 'sv_projects',
        values: { id: 'p1', workspaceId: WS, slug: 'hazard', createdBy: 'user-1' },
      },
    ])
    expect(mockCall.mock.calls[1][2].body).toEqual({
      workflows: [{ simWorkflowId: 'wf-1', enabled: true }],
    })
    expect((await res.json()).workflows).toHaveLength(1)

    // A Python project (ADR-0040): the language goes to the orchestrator as chosen.
    mockCall.mockResolvedValueOnce(reply(201, project('p2', { language: 'python' })))
    const py = await POST(
      createMockRequest('POST', {
        workspaceId: WS,
        name: 'Py',
        slug: 'py',
        vssRelease: 'v4.0',
        workflowIds: [],
        language: 'python',
      })
    )
    expect(py.status).toBe(200)
    expect(mockCall.mock.calls[2][2].body).toMatchObject({ slug: 'py', language: 'python' })
  })

  it('refuses to create without write access and relays a taken folder name', async () => {
    const body = { workspaceId: WS, name: 'A', slug: 'a', vssRelease: 'v4.0', workflowIds: [] }
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
    expect((await POST(createMockRequest('POST', body))).status).toBe(403)
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mockCall.mockResolvedValue(
      reply(409, { error: 'conflict', message: 'project a already exists' })
    )
    const res = await POST(createMockRequest('POST', body))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('project a already exists')
    expect(dbState.inserts).toEqual([])
  })

  it('reports an unreachable orchestrator as 502', async () => {
    mockCall.mockRejectedValue(new TypeError('fetch failed'))
    const res = await POST(
      createMockRequest('POST', {
        workspaceId: WS,
        name: 'A',
        slug: 'a',
        vssRelease: 'v4.0',
        workflowIds: [],
      })
    )
    expect(res.status).toBe(502)
  })
})
