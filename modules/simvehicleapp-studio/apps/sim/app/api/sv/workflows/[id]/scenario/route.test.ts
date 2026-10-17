/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockAuthorize, mockAssertMutable, cases } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockAuthorize: vi.fn(),
  mockAssertMutable: vi.fn(),
  cases: { list: [] as { scenario: unknown }[], saved: [] as unknown[] },
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

// The scenario is the workflow's first test case (ADR-0058, M18-T02).
vi.mock('@/lib/sv/server/test-cases', () => ({
  listTestCases: async () => cases.list,
  saveFirstCase: async (workflowId: string, scenario: unknown) => {
    cases.saved.push({ workflowId, scenario })
  },
}))

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
    cases.list = []
    cases.saved = []
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorize.mockResolvedValue({ workflow: { id: 'wf-1' }, allowed: true })
    mockAssertMutable.mockResolvedValue(undefined)
  })

  it('GET returns null until a case is saved, then the first test case', async () => {
    let res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ scenario: null })
    cases.list = [{ scenario }, { scenario: { ...scenario, name: 'second' } }]
    res = await GET(createMockRequest('GET', undefined, {}, url), ctx())
    expect(await res.json()).toEqual({ scenario })
  })

  it('PUT validates and saves the first test case (1.1 expectations accepted)', async () => {
    const res = await PUT(createMockRequest('PUT', { scenario }, {}, url), ctx())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scenario })
    expect(cases.saved).toEqual([{ workflowId: 'wf-1', scenario }])
    const v11 = {
      ...scenario,
      scenarioVersion: '1.1.0',
      expect: {
        writes: [
          { t: 2000, path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: true, within: 300 },
        ],
        never: [{ path: 'Vehicle.ADAS.LaneDepartureDetection.IsEnabled', from: 0 }],
      },
    }
    expect((await PUT(createMockRequest('PUT', { scenario: v11 }, {}, url), ctx())).status).toBe(
      200
    )
    cases.saved = cases.saved.slice(0, 1)
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
    expect(cases.saved).toHaveLength(1)
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
