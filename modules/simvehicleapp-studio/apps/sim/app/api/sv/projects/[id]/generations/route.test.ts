/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAccess, mockCall, mockLoad, mockAdapt, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAccess: vi.fn(),
  mockCall: vi.fn(),
  mockLoad: vi.fn(),
  mockAdapt: vi.fn(),
  dbState: { tables: {} as Record<string, unknown[]> },
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
  loadWorkflowFromNormalizedTables: mockLoad,
}))
vi.mock('@/lib/sv/graph-adapter', () => ({
  adaptWorkflow: mockAdapt,
  issueToDiagnostic: (i: { code: string; message: string }, workflowId: string) => ({
    code: i.code,
    severity: 'error',
    stage: 'structural',
    workflowId,
    message: i.message,
    docs: `diagnostics#${i.code}`,
  }),
}))
vi.mock('@sim/db/schema', () => ({
  svProjects: { _: 'sv_projects', id: 'id' },
  workflow: { _: 'workflow', id: 'id', workspaceId: 'workspace_id' },
  svWorkflowSettings: { _: 'sv_workflow_settings', workflowId: 'workflow_id' },
  svWorkflowScenarios: { _: 'sv_workflow_scenarios', workflowId: 'workflow_id' },
}))
vi.mock('@sim/db', () => {
  const select = () => ({
    from: (table: { _: string }) => ({
      where: () => {
        const rows = dbState.tables[table._] ?? []
        return { limit: async () => rows, then: (f: (r: unknown[]) => unknown) => f(rows) }
      },
    }),
  })
  return { db: { select } }
})

import { POST } from '@/app/api/sv/projects/[id]/generations/route'

const ctx = { params: Promise.resolve({ id: 'p1' }) }
const url = 'http://localhost/api/sv/projects/p1/generations'
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const project = (workflows: { simWorkflowId: string; enabled: boolean }[]) => ({
  id: 'p1',
  slug: 'hazard',
  name: 'Hazard',
  appName: 'Hazard',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'trigger' },
  status: 'ready',
  workflows,
})
const generation = {
  id: 'g_1',
  generationId: 'g_1',
  projectId: 'p1',
  state: 'queued',
  stages: [{ name: 'ir', state: 'pending' }],
  verification: { ir: 'pending', format: 'pending', compile: 'pending', tests: 'pending' },
  diagnostics: [],
  generatedFiles: [],
  workflows: [],
  createdAt: 1,
}
const scenario = { scenarioVersion: '1.0.0', name: 'S', until: 1000, inputs: [] }
const openGraph = { graphVersion: '1.0.0', workflowId: 'wf-a', name: 'A (editor)' }

describe('POST /api/sv/projects/[id]/generations (M07-T18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.tables = {
      sv_projects: [{ id: 'p1', workspaceId: 'ws-1', slug: 'hazard' }],
      workflow: [
        { id: 'wf-a', name: 'A', variables: {} },
        { id: 'wf-b', name: 'B', variables: {} },
      ],
      sv_workflow_settings: [{ workflowId: 'wf-b', vssRelease: 'v4.0' }],
      sv_workflow_scenarios: [
        { workflowId: 'wf-b', scenario },
        { workflowId: 'wf-a', scenario: { name: 'old format' } },
      ],
    }
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
    mockLoad.mockResolvedValue({ blocks: {}, edges: [], loops: {}, parallels: {} })
    mockAdapt.mockImplementation((i: { workflowId: string; name: string; vssRelease: string }) => ({
      graph: {
        graphVersion: '1.0.0',
        workflowId: i.workflowId,
        name: i.name,
        vss: { release: i.vssRelease },
      },
      issues: [],
    }))
  })

  it('sends the editor graph for the open workflow, saved graphs and scenarios for the others', async () => {
    mockCall
      .mockResolvedValueOnce(
        reply(
          200,
          project([
            { simWorkflowId: 'wf-a', enabled: true },
            { simWorkflowId: 'wf-b', enabled: true },
          ])
        )
      )
      .mockResolvedValueOnce(reply(202, generation))
    const res = await POST(
      createMockRequest('POST', { open: { workflowId: 'wf-a', graph: openGraph } }, {}, url),
      ctx
    )
    expect(res.status).toBe(202)
    expect((await res.json()).id).toBe('g_1')
    const [, path, init] = mockCall.mock.calls[1]
    expect(path).toBe('/projects/p1/generations')
    expect(init.body.graphs).toEqual([
      openGraph,
      { graphVersion: '1.0.0', workflowId: 'wf-b', name: 'B', vss: { release: 'v4.0' } },
    ])
    expect(init.body.scenarios).toEqual([{ workflowId: 'wf-b', scenario }])
    expect(mockAdapt).toHaveBeenCalledTimes(1)
  })

  it('refuses a project of a workspace the user cannot access', async () => {
    mockAccess.mockResolvedValue({ exists: true, hasAccess: false, canWrite: false })
    const res = await POST(createMockRequest('POST', {}, {}, url), ctx)
    expect(res.status).toBe(404)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('asks for workflows when none is assigned', async () => {
    mockCall.mockResolvedValueOnce(reply(200, project([{ simWorkflowId: 'wf-a', enabled: false }])))
    const res = await POST(createMockRequest('POST', {}, {}, url), ctx)
    expect(res.status).toBe(400)
  })

  it('refuses to generate a workflow the adapter could not carry completely', async () => {
    mockCall.mockResolvedValueOnce(reply(200, project([{ simWorkflowId: 'wf-b', enabled: true }])))
    mockAdapt.mockReturnValueOnce({
      graph: {},
      issues: [{ code: 'CONTAINER_INVALID', blockId: 'loop-1', message: 'Loop needs a count' }],
    })
    const res = await POST(createMockRequest('POST', {}, {}, url), ctx)
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.diagnostics[0]).toMatchObject({ code: 'CONTAINER_INVALID', workflowId: 'wf-b' })
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('relays the orchestrator diagnostics of an invalid graph', async () => {
    mockCall
      .mockResolvedValueOnce(reply(200, project([{ simWorkflowId: 'wf-b', enabled: true }])))
      .mockResolvedValueOnce(
        reply(422, [
          {
            code: 'GRAPH_SCHEMA_INVALID',
            severity: 'error',
            stage: 'parse',
            message: 'bad graph',
            docs: 'diagnostics#GRAPH_SCHEMA_INVALID',
          },
        ])
      )
    const res = await POST(createMockRequest('POST', {}, {}, url), ctx)
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('bad graph')
  })
})
