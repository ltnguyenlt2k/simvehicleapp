/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAuthorize, mockAssertMutable, mockReleases, dbState } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockAuthorize: vi.fn(),
    mockAssertMutable: vi.fn(),
    mockReleases: vi.fn(),
    dbState: { rows: [] as { vssRelease: string }[], upserts: [] as unknown[] },
  })
)

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@sim/platform-authz/workflow', () => {
  class WorkflowLockedError extends Error {
    readonly status = 423
  }
  return {
    authorizeWorkflowByWorkspacePermission: mockAuthorize,
    assertWorkflowMutable: mockAssertMutable,
    WorkflowLockedError,
  }
})

vi.mock('@sim/db/schema', () => ({
  svWorkflowSettings: { workflowId: 'workflow_id', vssRelease: 'vss_release' },
}))

vi.mock('@/lib/sv/catalog-proxy', () => ({ fetchCatalogReleases: mockReleases }))

vi.mock('@sim/db', () => {
  const select = () => ({
    from: () => ({ where: () => ({ limit: async () => dbState.rows }) }),
  })
  const insert = () => ({
    values: (v: unknown) => ({
      onConflictDoUpdate: async (c: unknown) => {
        dbState.upserts.push({ values: v, conflict: c })
      },
    }),
  })
  return { db: { select, insert } }
})

import { WorkflowLockedError } from '@sim/platform-authz/workflow'
import { GET, PUT } from '@/app/api/sv/workflows/[id]/settings/route'

const ctx = (id = 'wf-1') => ({ params: Promise.resolve({ id }) })
const url = 'http://localhost:3000/api/sv/workflows/wf-1/settings'

describe('/api/sv/workflows/[id]/settings (M02-T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.rows = []
    dbState.upserts = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: true })
    mockAssertMutable.mockResolvedValue(undefined)
    mockReleases.mockResolvedValue(['v4.0', 'v4.2'])
  })

  it('GET returns null (catalog default) when nothing is pinned, then the pinned release', async () => {
    let res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ vssRelease: null })
    dbState.rows = [{ vssRelease: 'v4.2' }]
    res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ vssRelease: 'v4.2' })
    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'read',
    })
  })

  it('requires a session and workflow permission', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await GET(createMockRequest('GET', undefined, {}, url), ctx())).status).toBe(401)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({ workflow: null, allowed: false })
    expect((await GET(createMockRequest('GET', undefined, {}, url), ctx())).status).toBe(404)
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: false, status: 403 })
    expect(
      (await PUT(createMockRequest('PUT', { vssRelease: 'v4.2' }, {}, url), ctx())).status
    ).toBe(403)
    expect(dbState.upserts).toEqual([])
  })

  it('PUT upserts a release the catalog serves', async () => {
    const res = await PUT(createMockRequest('PUT', { vssRelease: 'v4.2' }, {}, url), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ vssRelease: 'v4.2' })
    expect(dbState.upserts).toHaveLength(1)
    expect(mockAuthorize).toHaveBeenCalledWith({
      workflowId: 'wf-1',
      userId: 'user-1',
      action: 'write',
    })
  })

  it('PUT rejects malformed or unknown releases and a locked workflow', async () => {
    expect(
      (await PUT(createMockRequest('PUT', { vssRelease: '4.2' }, {}, url), ctx())).status
    ).toBe(400)
    const unknown = await PUT(createMockRequest('PUT', { vssRelease: 'v9.9' }, {}, url), ctx())
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).error).toContain('v9.9 is not available')
    mockAssertMutable.mockRejectedValue(new WorkflowLockedError('Workflow is locked'))
    expect(
      (await PUT(createMockRequest('PUT', { vssRelease: 'v4.2' }, {}, url), ctx())).status
    ).toBe(423)
    expect(dbState.upserts).toEqual([])
  })

  it('PUT answers 502 when the catalog is unreachable', async () => {
    mockReleases.mockResolvedValue(null)
    expect(
      (await PUT(createMockRequest('PUT', { vssRelease: 'v4.2' }, {}, url), ctx())).status
    ).toBe(502)
  })
})
