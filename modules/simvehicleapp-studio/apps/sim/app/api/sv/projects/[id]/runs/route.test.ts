/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAccess, mockCall, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAccess: vi.fn(),
  mockCall: vi.fn(),
  dbState: { rows: [] as unknown[] },
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
vi.mock('@/lib/workflows/persistence/utils', () => ({ loadWorkflowFromNormalizedTables: vi.fn() }))
vi.mock('@sim/db/schema', () => ({
  svProjects: { _: 'sv_projects', id: 'id' },
  workflow: { _: 'workflow' },
  svWorkflowSettings: { _: 'sv_workflow_settings' },
  svWorkflowScenarios: { _: 'sv_workflow_scenarios' },
}))
vi.mock('@sim/db', () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => dbState.rows }) }),
    }),
  },
}))

import { GET as getRun } from '@/app/api/sv/projects/[id]/runs/[rid]/route'
import { POST } from '@/app/api/sv/projects/[id]/runs/route'
import { POST as setSignal } from '@/app/api/sv/projects/[id]/signals/route'

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const run = (projectId: string, extra: Record<string, unknown> = {}) => ({
  id: 'r_1',
  projectId,
  generationId: 'g_1',
  state: 'running',
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  ...extra,
})
const project = {
  id: 'p1',
  slug: 'hazard',
  name: 'Hazard',
  appName: 'Hazard',
  language: 'cpp',
  vssRelease: 'v4.2',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: 'ready',
  workflows: [],
}
const ctx = { params: Promise.resolve({ id: 'p1' }) }

describe('/api/sv/projects/[id]/runs + signals (M08-T08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.rows = [{ id: 'p1', workspaceId: 'ws-1', slug: 'hazard' }]
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
  })

  it('starts a run of the latest SynCode', async () => {
    mockCall.mockResolvedValueOnce(reply(202, run('p1', { state: 'starting' })))
    const res = await POST(createMockRequest('POST', {}), ctx)
    expect(res.status).toBe(202)
    expect(mockCall.mock.calls[0][1]).toBe('/projects/p1/runs')
    expect((await res.json()).state).toBe('starting')
  })

  it('a run of another project blocks the stack without revealing it', async () => {
    mockCall.mockResolvedValueOnce(
      reply(409, {
        error: 'conflict',
        message: 'Another run is active: stop it first',
        activeRun: run('p_secret'),
      })
    )
    const res = await POST(createMockRequest('POST', {}), ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('Another project is running')
    expect(JSON.stringify(body)).not.toContain('p_secret')
    expect(JSON.stringify(body)).not.toContain('r_1')
  })

  it("another project's run is not found", async () => {
    mockCall.mockResolvedValueOnce(reply(200, run('other')))
    const res = await getRun(createMockRequest('GET'), {
      params: Promise.resolve({ id: 'p1', rid: 'r_1' }),
    })
    expect(res.status).toBe(404)
  })

  it('injects on the databroker of the project release; the gateway refusal comes back', async () => {
    mockCall
      .mockResolvedValueOnce(reply(200, project))
      .mockResolvedValueOnce(
        reply(200, { path: 'Vehicle.Speed', ts: 5, value: 130, field: 'value' })
      )
    const ok = await setSignal(
      createMockRequest('POST', { path: 'Vehicle.Speed', value: 130, field: 'value' }),
      ctx
    )
    expect(ok.status).toBe(200)
    expect(mockCall.mock.calls[1][0]).toBe('signal-gateway')
    expect(mockCall.mock.calls[1][2].body).toEqual({
      release: 'v4.2',
      path: 'Vehicle.Speed',
      value: 130,
      field: 'value',
    })
    mockCall
      .mockResolvedValueOnce(reply(200, project))
      .mockResolvedValueOnce(
        reply(400, { error: 'invalid_value', message: 'Vehicle.Speed expects a number' })
      )
    const bad = await setSignal(
      createMockRequest('POST', { path: 'Vehicle.Speed', value: 'x', field: 'value' }),
      ctx
    )
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toBe('Vehicle.Speed expects a number')
  })

  it('reading needs access, injecting needs write access', async () => {
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
    expect(
      (
        await setSignal(
          createMockRequest('POST', { path: 'Vehicle.Speed', value: 1, field: 'value' }),
          ctx
        )
      ).status
    ).toBe(403)
    expect((await POST(createMockRequest('POST', {}), ctx)).status).toBe(403)
    expect(mockCall).not.toHaveBeenCalled()
  })
})
