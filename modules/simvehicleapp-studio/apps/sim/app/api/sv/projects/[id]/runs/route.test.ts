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

import { POST as extendRun } from '@/app/api/sv/projects/[id]/runs/[rid]/extend/route'
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
    expect(mockCall.mock.calls[0][2].body).toEqual({
      owner: { userId: 'user-1', workspaceId: 'ws-1' },
    })
    expect((await res.json()).state).toBe('starting')
  })

  it('a reached run quota (ADR-0057) answers 409 RUN_QUOTA_EXCEEDED with its message', async () => {
    mockCall.mockResolvedValueOnce(
      reply(409, [
        {
          code: 'RUN_QUOTA_EXCEEDED',
          severity: 'error',
          stage: 'run',
          message: 'You already have 2 apps running: the limit is 2. Stop one of them first.',
          docs: 'diagnostics#RUN_QUOTA_EXCEEDED',
          data: { scope: 'user', limit: 2, runs: [run('p_other')] },
        },
      ])
    )
    const res = await POST(createMockRequest('POST', {}), ctx)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toEqual({
      error: 'You already have 2 apps running: the limit is 2. Stop one of them first.',
      code: 'RUN_QUOTA_EXCEEDED',
    })
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

  it('extends a run of the project; a refusal keeps its reason (ADR-0057)', async () => {
    const rctx = { params: Promise.resolve({ id: 'p1', rid: 'r_1' }) }
    mockCall
      .mockResolvedValueOnce(reply(200, run('p1')))
      .mockResolvedValueOnce(reply(409, { error: 'conflict', message: 'already extended 3 times' }))
    const refused = await extendRun(createMockRequest('POST'), rctx)
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain('already extended')
    mockCall
      .mockResolvedValueOnce(reply(200, run('p1')))
      .mockResolvedValueOnce(reply(200, run('p1', { expiresAt: 99, extensions: 1 })))
    const ok = await extendRun(createMockRequest('POST'), rctx)
    expect(ok.status).toBe(200)
    expect(mockCall.mock.calls.at(-1)?.[1]).toBe('/runs/r_1/extend')
    expect(await ok.json()).toMatchObject({ expiresAt: 99, extensions: 1 })
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
      .mockResolvedValueOnce(reply(200, { runs: [] }))
      .mockResolvedValueOnce(
        reply(200, { path: 'Vehicle.Speed', ts: 5, value: 130, field: 'value' })
      )
    const ok = await setSignal(
      createMockRequest('POST', { path: 'Vehicle.Speed', value: 130, field: 'value' }),
      ctx
    )
    expect(ok.status).toBe(200)
    expect(mockCall.mock.calls[1][1]).toBe('/runs?projectId=p1&active=true')
    expect(mockCall.mock.calls[2][0]).toBe('signal-gateway')
    expect(mockCall.mock.calls[2][2].body).toEqual({
      release: 'v4.2',
      path: 'Vehicle.Speed',
      value: 130,
      field: 'value',
    })
    mockCall
      .mockResolvedValueOnce(reply(200, project))
      .mockResolvedValueOnce(reply(200, { runs: [] }))
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

  it("injects on the app's own databroker while it runs in a sandbox (ADR-0057); never an address the run did not report", async () => {
    mockCall
      .mockResolvedValueOnce(reply(200, project))
      .mockResolvedValueOnce(reply(200, { runs: [run('p1', { sandbox: 'toolchain-cpp:56003' })] }))
      .mockResolvedValueOnce(reply(200, { path: 'Vehicle.Speed', ts: 5, value: 1, field: 'value' }))
    await setSignal(
      createMockRequest('POST', { path: 'Vehicle.Speed', value: 1, field: 'value' }),
      ctx
    )
    expect(mockCall.mock.calls[2][2].body).toMatchObject({
      release: 'v4.2',
      sandbox: 'toolchain-cpp:56003',
    })
    mockCall
      .mockResolvedValueOnce(reply(200, project))
      .mockResolvedValueOnce(reply(200, { runs: [run('p1', { sandbox: 'mqtt:1883' })] }))
      .mockResolvedValueOnce(reply(200, { path: 'Vehicle.Speed', ts: 5, value: 1, field: 'value' }))
    await setSignal(
      createMockRequest('POST', { path: 'Vehicle.Speed', value: 1, field: 'value' }),
      ctx
    )
    expect(mockCall.mock.calls[5][2].body.sandbox).toBeUndefined()
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
