/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAuthorize, mockAssertMutable, dbState } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAuthorize: vi.fn(),
  mockAssertMutable: vi.fn(),
  dbState: { rows: [] as { scenario: unknown }[], upserts: [] as unknown[] },
}))

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
  svWorkflowScenarios: { workflowId: 'workflow_id', scenario: 'scenario' },
}))

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
import { GET, PUT } from '@/app/api/sv/workflows/[id]/scenario/route'

const ctx = (id = 'wf-1') => ({ params: Promise.resolve({ id }) })
const url = 'http://localhost:3000/api/sv/workflows/wf-1/scenario'
const scenario = {
  scenarioVersion: '1.0.0',
  name: 'Overspeed',
  until: 6000,
  initial: { 'Vehicle.Speed': 0 },
  inputs: [
    { t: 1000, path: 'Vehicle.Speed', value: 130 },
    { t: 2000, topic: 'vehicle/cmd', value: 'ON' },
  ],
}

describe('/api/sv/workflows/[id]/scenario (M05-T09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbState.rows = []
    dbState.upserts = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: true })
    mockAssertMutable.mockResolvedValue(undefined)
  })

  it('GET returns null until a scenario is saved; an invalid stored one reads as null', async () => {
    let res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ scenario: null })
    dbState.rows = [{ scenario }]
    res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ scenario })
    dbState.rows = [{ scenario: { name: 'old format' } }]
    res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ scenario: null })
  })

  it('PUT validates and upserts the scenario', async () => {
    const res = await PUT(createMockRequest('PUT', { scenario }, {}, url), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenario })
    expect(dbState.upserts).toHaveLength(1)
    const bad = await PUT(
      createMockRequest('PUT', { scenario: { ...scenario, until: 90_000_000 } }, {}, url),
      ctx()
    )
    expect(bad.status).toBe(400)
    const badPath = await PUT(
      createMockRequest(
        'PUT',
        { scenario: { ...scenario, inputs: [{ t: 1, path: 'speed', value: 1 }] } },
        {},
        url
      ),
      ctx()
    )
    expect(badPath.status).toBe(400)
    expect(dbState.upserts).toHaveLength(1)
  })

  it('needs a session, permission and an unlocked workflow', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await GET(createMockRequest('GET', undefined, {}, url), ctx())).status).toBe(401)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: false, status: 403 })
    expect((await PUT(createMockRequest('PUT', { scenario }, {}, url), ctx())).status).toBe(403)
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: true })
    mockAssertMutable.mockRejectedValue(new WorkflowLockedError('locked'))
    expect((await PUT(createMockRequest('PUT', { scenario }, {}, url), ctx())).status).toBe(423)
  })
})
