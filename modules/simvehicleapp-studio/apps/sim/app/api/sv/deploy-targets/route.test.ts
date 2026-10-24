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

import { DELETE as deleteTarget } from '@/app/api/sv/deploy-targets/[id]/route'
import { POST as testTarget } from '@/app/api/sv/deploy-targets/[id]/test/route'
import { POST as createTarget, GET as listTargets } from '@/app/api/sv/deploy-targets/route'
import { POST as deploy } from '@/app/api/sv/projects/[id]/deployments/route'
import { POST as pushImage } from '@/app/api/sv/projects/[id]/images/route'

const reply = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const target = {
  id: 'dt_1',
  workspaceId: 'ws-1',
  name: 'HIL',
  address: 'hil.lab:55555',
  tls: true,
  vssRelease: 'v4.0',
  createdAt: 1,
  hasToken: true,
}
const deployment = {
  id: 'r_9',
  projectId: 'p1',
  generationId: 'g_1',
  state: 'starting',
  vssRelease: 'v4.0',
  traceLevel: 'node',
  diagnostics: [],
  createdAt: 1,
  deploy: { targetId: 'dt_1', targetName: 'HIL', mode: 'read-only' },
}
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const tctx = { params: Promise.resolve({ id: 'dt_1' }) }
const req = (method: string, url: string, body?: unknown) =>
  createMockRequest(method, body, {}, url)

describe('/api/sv/deploy-targets and deployments (ADR-0060, M18-T09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.rows = [{ id: 'p1', workspaceId: 'ws-1', slug: 'hazard' }]
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true, canAdmin: false })
  })

  it('members list targets; only admins add or remove them', async () => {
    mockCall.mockResolvedValueOnce(reply(200, { targets: [target] }))
    const list = await listTargets(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost/api/sv/deploy-targets?workspaceId=ws-1'
      )
    )
    expect((await list.json()).targets).toEqual([target])
    const body = {
      workspaceId: 'ws-1',
      name: 'HIL',
      address: 'hil.lab:55555',
      tls: true,
      token: 'tok',
      vssRelease: 'v4.0',
    }
    expect(
      (await createTarget(req('POST', 'http://localhost/api/sv/deploy-targets', body))).status
    ).toBe(403)
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true, canAdmin: true })
    mockCall.mockResolvedValueOnce(reply(201, target))
    const created = await createTarget(req('POST', 'http://localhost/api/sv/deploy-targets', body))
    expect(created.status).toBe(201)
    expect(mockCall.mock.calls.at(-1)?.[2].body).toEqual(body)
    expect(
      (
        await createTarget(
          req('POST', 'http://localhost/api/sv/deploy-targets', { ...body, address: 'nope' })
        )
      ).status
    ).toBe(400)
    mockCall.mockResolvedValueOnce(
      reply(409, { message: 'HIL has 1 active deployment(s): stop them first' })
    )
    const busy = await deleteTarget(
      req('DELETE', 'http://localhost/api/sv/deploy-targets/dt_1?workspaceId=ws-1'),
      tctx
    )
    expect(busy.status).toBe(409)
    mockCall.mockResolvedValueOnce(reply(204, null))
    expect(
      (
        await deleteTarget(
          req('DELETE', 'http://localhost/api/sv/deploy-targets/dt_1?workspaceId=ws-1'),
          tctx
        )
      ).status
    ).toBe(200)
  })

  it('Test connection relays the probe; a stranger to the workspace sees nothing', async () => {
    mockCall.mockResolvedValueOnce(
      reply(200, {
        reachable: true,
        api: 'kuksa.val.v2',
        server: { name: 'databroker', version: '0.5.0' },
        missing: [],
      })
    )
    const ok = await testTarget(
      req('POST', 'http://localhost/api/sv/deploy-targets/dt_1/test', {
        workspaceId: 'ws-1',
        paths: ['Vehicle.Speed'],
      }),
      tctx
    )
    expect(await ok.json()).toMatchObject({ reachable: true })
    mockAccess.mockResolvedValue({
      exists: true,
      hasAccess: false,
      canWrite: false,
      canAdmin: false,
    })
    expect(
      (
        await testTarget(
          req('POST', 'http://localhost/api/sv/deploy-targets/dt_1/test', { workspaceId: 'ws-1' }),
          tctx
        )
      ).status
    ).toBe(404)
  })

  it('deploys read-only as an editor; read-write needs an admin; the quota answers 409', async () => {
    mockCall.mockResolvedValueOnce(reply(202, deployment))
    const res = await deploy(
      req('POST', 'http://localhost/api/sv/projects/p1/deployments', {
        targetId: 'dt_1',
        mode: 'read-only',
      }),
      ctx
    )
    expect(res.status).toBe(202)
    expect(mockCall.mock.calls[0][1]).toBe('/projects/p1/deployments')
    expect(mockCall.mock.calls[0][2].body).toEqual({
      targetId: 'dt_1',
      mode: 'read-only',
      owner: { userId: 'user-1', workspaceId: 'ws-1' },
    })
    expect((await res.json()).deploy.mode).toBe('read-only')
    expect(
      (
        await deploy(
          req('POST', 'http://localhost/api/sv/projects/p1/deployments', {
            targetId: 'dt_1',
            mode: 'read-write',
          }),
          ctx
        )
      ).status
    ).toBe(403)
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true, canAdmin: true })
    mockCall.mockResolvedValueOnce(
      reply(409, [
        {
          code: 'DEPLOY_QUOTA_EXCEEDED',
          severity: 'error',
          stage: 'run',
          message: 'This workspace has 2 deployments',
          docs: 'diagnostics#DEPLOY_QUOTA_EXCEEDED',
        },
      ])
    )
    const quota = await deploy(
      req('POST', 'http://localhost/api/sv/projects/p1/deployments', {
        targetId: 'dt_1',
        mode: 'read-write',
      }),
      ctx
    )
    expect(quota.status).toBe(409)
    expect(await quota.json()).toMatchObject({ code: 'DEPLOY_QUOTA_EXCEEDED' })
  })

  it('pushes the app image to a registry (M18-T10); a failed push says why', async () => {
    mockCall.mockResolvedValueOnce(
      reply(200, {
        reference: 'reg:5000/lka:1',
        digest: 'sha256:ab',
        bytes: 9,
        files: 8,
        generationId: 'g_1',
      })
    )
    const ok = await pushImage(
      req('POST', 'http://localhost/api/sv/projects/p1/images', {
        reference: 'reg:5000/lka:1',
        insecure: true,
      }),
      ctx
    )
    expect(ok.status).toBe(200)
    expect(mockCall.mock.calls[0][1]).toBe('/projects/p1/images')
    expect(mockCall.mock.calls[0][2].body).toEqual({ reference: 'reg:5000/lka:1', insecure: true })
    expect(
      (
        await pushImage(
          req('POST', 'http://localhost/api/sv/projects/p1/images', { reference: 'nope' }),
          ctx
        )
      ).status
    ).toBe(400)
    mockCall.mockResolvedValueOnce(
      reply(422, {
        error: 'image_failed',
        message: 'push failed: registry refused the manifest: 401',
      })
    )
    const failed = await pushImage(
      req('POST', 'http://localhost/api/sv/projects/p1/images', { reference: 'reg:5000/lka:1' }),
      ctx
    )
    expect(failed.status).toBe(422)
    expect((await failed.json()).error).toContain('401')
  })
})
