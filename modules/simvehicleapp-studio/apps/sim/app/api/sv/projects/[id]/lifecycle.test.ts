/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Vehicle app lifecycle and capacity routes of the BFF (ADR-0053, M16-T04). */

const { mockGetSession, mockAccess, mockCall, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAccess: vi.fn(),
  mockCall: vi.fn(),
  dbState: {
    tables: {} as Record<string, unknown[]>,
    archived: [] as { id: string }[],
    deletes: [] as { table: string; where: unknown }[],
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
  workspace: { _: 'workspace', id: 'id', archivedAt: 'archived_at' },
  svWorkflowSettings: { _: 'sv_workflow_settings' },
  svWorkflowScenarios: { _: 'sv_workflow_scenarios' },
}))
vi.mock('@sim/db', () => {
  const rowsOf = (table: { _: string }) => dbState.tables[table._] ?? []
  const result = (rows: unknown[]) => ({
    limit: async () => rows,
    then: (f: (r: unknown[]) => unknown) => f(rows),
  })
  const select = () => ({
    from: (table: { _: string }) => ({
      where: () => result(rowsOf(table)),
      innerJoin: () => ({ where: () => result(dbState.archived) }),
      then: (f: (r: unknown[]) => unknown) => f(rowsOf(table)),
    }),
  })
  const del = (table: { _: string }) => ({
    where: async (where: unknown) => {
      dbState.deletes.push({ table: table._, where })
    },
  })
  return { db: { select, delete: del } }
})

import { GET as CAPACITY } from '@/app/api/sv/capacity/route'
import { POST as CLEAN } from '@/app/api/sv/projects/[id]/clean/route'
import { POST as REPAIR } from '@/app/api/sv/projects/[id]/repair/route'
import { DELETE } from '@/app/api/sv/projects/[id]/route'
import { GET as SIZE } from '@/app/api/sv/projects/[id]/size/route'
import { POST as RECONCILE } from '@/app/api/sv/reconcile/route'

const WS = 'ws-1'
const ROW = { id: 'p1', workspaceId: WS, slug: 'app-p1' }
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
const project = (extra: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'app-p1',
  name: 'App',
  appName: 'App',
  language: 'cpp',
  vssRelease: 'v4.0',
  settings: { mqttTopicPrefix: 'sv', traceLevel: 'node' },
  status: 'creating',
  workflows: [],
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  dbState.tables = { sv_projects: [ROW] }
  dbState.archived = []
  dbState.deletes = []
  mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: true })
})

describe('DELETE /api/sv/projects/[id]', () => {
  it('deletes the app in the orchestrator, then the workspace link', async () => {
    mockCall.mockResolvedValueOnce(reply(204))
    const res = await DELETE(createMockRequest('DELETE'), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(mockCall.mock.calls[0][1]).toBe('/projects/p1')
    expect(mockCall.mock.calls[0][2].method).toBe('DELETE')
    expect(dbState.deletes.map((d) => d.table)).toEqual(['sv_projects'])
  })

  it('an app the orchestrator no longer has is unlinked too (404 upstream)', async () => {
    mockCall.mockResolvedValueOnce(reply(404, { error: 'not_found' }))
    expect((await DELETE(createMockRequest('DELETE'), ctx)).status).toBe(200)
    expect(dbState.deletes).toHaveLength(1)
  })

  it('a building SynCode answers 409 and keeps the link; viewers cannot delete', async () => {
    mockCall.mockResolvedValueOnce(
      reply(409, { error: 'conflict', message: 'A SynCode of App is building' })
    )
    const busy = await DELETE(createMockRequest('DELETE'), ctx)
    expect(busy.status).toBe(409)
    expect((await busy.json()).error).toContain('building')
    expect(dbState.deletes).toEqual([])
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
    expect((await DELETE(createMockRequest('DELETE'), ctx)).status).toBe(403)
  })

  it('an unreachable orchestrator is 502 and nothing is unlinked', async () => {
    mockCall.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect((await DELETE(createMockRequest('DELETE'), ctx)).status).toBe(502)
    expect(dbState.deletes).toEqual([])
  })
})

describe('repair, clean, size', () => {
  it('repair relays the app (creating again); a ready app is 409', async () => {
    mockCall.mockResolvedValueOnce(reply(202, project()))
    const ok = await REPAIR(createMockRequest('POST'), ctx)
    expect(ok.status).toBe(200)
    expect((await ok.json()).status).toBe('creating')
    mockCall.mockResolvedValueOnce(
      reply(409, { error: 'conflict', message: 'Only a failed app can be repaired' })
    )
    expect((await REPAIR(createMockRequest('POST'), ctx)).status).toBe(409)
  })

  it('clean returns the bytes freed; busy is 409', async () => {
    mockCall.mockResolvedValueOnce(reply(200, { freedBytes: 149000024 }))
    const ok = await CLEAN(createMockRequest('POST'), ctx)
    expect(await ok.json()).toEqual({ freedBytes: 149000024 })
    mockCall.mockResolvedValueOnce(
      reply(409, { error: 'conflict', message: 'App is running: stop it first' })
    )
    expect((await CLEAN(createMockRequest('POST'), ctx)).status).toBe(409)
  })

  it('size needs only read access; an invalid answer is 502', async () => {
    mockAccess.mockResolvedValue({ exists: true, hasAccess: true, canWrite: false })
    mockCall.mockResolvedValueOnce(reply(200, { bytes: 2000, buildBytes: 1000 }))
    expect(await (await SIZE(createMockRequest('GET'), ctx)).json()).toEqual({
      bytes: 2000,
      buildBytes: 1000,
    })
    mockCall.mockResolvedValueOnce(reply(200, { bytes: -1 }))
    expect((await SIZE(createMockRequest('GET'), ctx)).status).toBe(502)
  })
})

describe('GET /api/sv/capacity', () => {
  it('disk, host and workspace quotas, queue', async () => {
    dbState.tables.sv_projects = [{ n: 3 }]
    mockCall.mockResolvedValueOnce(
      reply(200, {
        disk: { freeBytes: 7, totalBytes: 10, level: 'high', thresholds: {} },
        apps: { total: 42, limit: 100 },
        queue: { queued: 1, limit: 20 },
      })
    )
    const res = await CAPACITY(
      createMockRequest('GET', undefined, {}, `http://localhost/api/sv/capacity?workspaceId=${WS}`)
    )
    expect(await res.json()).toEqual({
      disk: { freeBytes: 7, totalBytes: 10, level: 'high' },
      host: { apps: 42, limit: 100 },
      workspace: { apps: 3, limit: 10 },
      queue: { queued: 1, limit: 20 },
    })
  })

  it('a disk that cannot be measured is null; another workspace is 404', async () => {
    dbState.tables.sv_projects = [{ n: 0 }]
    mockCall.mockResolvedValueOnce(
      reply(200, { disk: null, apps: { total: 0, limit: 100 }, queue: { queued: 0, limit: 20 } })
    )
    const res = await CAPACITY(
      createMockRequest('GET', undefined, {}, `http://localhost/api/sv/capacity?workspaceId=${WS}`)
    )
    expect((await res.json()).disk).toBeNull()
    mockAccess.mockResolvedValue({ exists: true, hasAccess: false, canWrite: false })
    expect(
      (
        await CAPACITY(
          createMockRequest(
            'GET',
            undefined,
            {},
            `http://localhost/api/sv/capacity?workspaceId=${WS}`
          )
        )
      ).status
    ).toBe(404)
  })
})

describe('POST /api/sv/reconcile', () => {
  it('deletes apps of archived workspaces and drops links to vanished apps; then waits an hour', async () => {
    dbState.archived = [{ id: 'p-archived' }]
    dbState.tables.sv_projects = [{ id: 'p-live' }, { id: 'p-vanished' }]
    mockCall
      .mockResolvedValueOnce(
        reply(200, { projects: [{ id: 'p-archived' }, { id: 'p-live' }, { id: 'p-gate' }] })
      )
      .mockResolvedValueOnce(reply(204))
    const res = await RECONCILE(createMockRequest('POST'))
    expect(await res.json()).toEqual({ deletedApps: 1, droppedLinks: 1 })
    expect(mockCall.mock.calls.map((c) => [c[1], c[2]?.method])).toEqual([
      ['/projects', undefined],
      ['/projects/p-archived', 'DELETE'],
    ])
    // the gate app (never linked) is not touched; a second call within the hour does nothing
    const again = await RECONCILE(createMockRequest('POST'))
    expect(await again.json()).toEqual({ deletedApps: 0, droppedLinks: 0 })
    expect(mockCall).toHaveBeenCalledTimes(2)
  })

  it('requires a session', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await RECONCILE(createMockRequest('POST'))).status).toBe(401)
  })
})
