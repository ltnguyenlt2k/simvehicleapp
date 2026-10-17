/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAuthorize, store } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  store: { cases: [] as { id: string; name: string; scenario: unknown; position: number }[] },
}))

vi.mock('@/lib/sv/server/authorize-workflow', () => ({ authorizeSvWorkflow: mockAuthorize }))
vi.mock('@/lib/sv/server/test-cases', () => ({
  listTestCases: async () => store.cases,
  createTestCase: async (_w: string, name: string, scenario: unknown) => {
    const c = { id: `tc_${store.cases.length + 1}`, name, scenario, position: store.cases.length }
    store.cases.push(c)
    return c
  },
  updateTestCase: async (_w: string, id: string, patch: object) => {
    const c = store.cases.find((x) => x.id === id)
    return c ? Object.assign(c, patch) : null
  },
  deleteTestCase: async (_w: string, id: string) => {
    const before = store.cases.length
    store.cases = store.cases.filter((x) => x.id !== id)
    return store.cases.length < before
  },
}))

import { NextResponse } from 'next/server'
import { DELETE, PATCH } from '@/app/api/sv/workflows/[id]/test-cases/[caseId]/route'
import { GET, POST } from '@/app/api/sv/workflows/[id]/test-cases/route'

const base = 'http://localhost:3000/api/sv/workflows/wf-1/test-cases'
const ctx = { params: Promise.resolve({ id: 'wf-1' }) }
const caseCtx = (caseId: string) => ({ params: Promise.resolve({ id: 'wf-1', caseId }) })
const scenario = {
  scenarioVersion: '1.1.0',
  name: 'Below the limit',
  until: 4000,
  inputs: [{ t: 0, path: 'Vehicle.Speed', value: 100 }],
  expect: { never: [{ path: 'Vehicle.Body.Lights.Hazard.IsSignaling' }] },
}

describe('/api/sv/workflows/[id]/test-cases (ADR-0058, M18-T02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.cases = []
    mockAuthorize.mockResolvedValue(null)
  })

  it('create, list in order, rename, delete', async () => {
    const created = await POST(
      createMockRequest('POST', { name: 'Below', scenario }, {}, base),
      ctx
    )
    expect(created.status).toBe(200)
    expect(await created.json()).toMatchObject({ id: 'tc_1', name: 'Below', position: 0 })
    await POST(createMockRequest('POST', { name: 'Above', scenario }, {}, base), ctx)
    const list = await (await GET(createMockRequest('GET', undefined, {}, base), ctx)).json()
    expect(list.cases.map((c: { name: string }) => c.name)).toEqual(['Below', 'Above'])
    const renamed = await PATCH(
      createMockRequest('PATCH', { name: 'Below 10 km/h' }, {}, `${base}/tc_1`),
      caseCtx('tc_1')
    )
    expect((await renamed.json()).name).toBe('Below 10 km/h')
    expect(
      (await DELETE(createMockRequest('DELETE', undefined, {}, `${base}/tc_2`), caseCtx('tc_2')))
        .status
    ).toBe(200)
    expect(store.cases.map((c) => c.id)).toEqual(['tc_1'])
    expect(
      (await DELETE(createMockRequest('DELETE', undefined, {}, `${base}/tc_9`), caseCtx('tc_9')))
        .status
    ).toBe(404)
  })

  it('validates the body: name, scenario 1.x, something to change', async () => {
    expect(
      (await POST(createMockRequest('POST', { name: ' ', scenario }, {}, base), ctx)).status
    ).toBe(400)
    expect(
      (
        await POST(
          createMockRequest(
            'POST',
            { name: 'x', scenario: { ...scenario, scenarioVersion: '2.0.0' } },
            {},
            base
          ),
          ctx
        )
      ).status
    ).toBe(400)
    await POST(createMockRequest('POST', { name: 'x', scenario }, {}, base), ctx)
    expect(
      (await PATCH(createMockRequest('PATCH', {}, {}, `${base}/tc_1`), caseCtx('tc_1'))).status
    ).toBe(400)
  })

  it('caps the number of cases; permission errors come back', async () => {
    store.cases = Array.from({ length: 50 }, (_, i) => ({
      id: `tc_${i}`,
      name: `c${i}`,
      scenario,
      position: i,
    }))
    expect(
      (await POST(createMockRequest('POST', { name: 'one more', scenario }, {}, base), ctx)).status
    ).toBe(409)
    mockAuthorize.mockResolvedValue(NextResponse.json({ error: 'Access denied' }, { status: 403 }))
    expect((await GET(createMockRequest('GET', undefined, {}, base), ctx)).status).toBe(403)
  })
})
