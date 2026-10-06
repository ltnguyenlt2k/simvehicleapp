/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCall } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCall: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/sv/api-client', () => {
  class SvServiceNotConfiguredError extends Error {}
  return { callSvService: mockCall, SvServiceNotConfiguredError }
})

import { POST } from '@/app/api/sv/simulate/route'

const url = 'http://localhost:3000/api/sv/simulate'
const graph = { graphVersion: '1.0.0', workflowId: 'wf', blocks: [] }
const scenario = { scenarioVersion: '1.0.0', name: 's', until: 1000, inputs: [] }
const diagnostic = (code: string, severity = 'error') => ({
  code,
  severity,
  stage: 'types',
  blockId: 'b1',
  message: code,
  docs: `diagnostics#${code}`,
})
const sim = {
  trace: [
    { runId: 'r', seq: 0, ts: 0, wf: 'wf', run: 1, node: 'n1', blockId: 'b1', ev: 'trigger' },
  ],
  writes: [{ t: 0, path: 'Vehicle.X', value: true }],
  signals: [],
  publishes: [],
  logs: [],
  diagnostics: [],
}

describe('POST /api/sv/simulate (M05-T09/T10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('compiles, then simulates the IR with the scenario', async () => {
    mockCall
      .mockResolvedValueOnce(
        Response.json({
          diagnostics: [diagnostic('UNIT_ASSUMED', 'info')],
          ir: { irVersion: '1.0.0' },
        })
      )
      .mockResolvedValueOnce(Response.json(sim))
    const res = await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.diagnostics.map((d: { code: string }) => d.code)).toEqual(['UNIT_ASSUMED'])
    expect(body.result.writes).toEqual(sim.writes)
    expect(mockCall).toHaveBeenNthCalledWith(1, 'compiler', '/compile', {
      method: 'POST',
      body: { graph, mode: 'build' },
      timeoutMs: 10000,
    })
    expect(mockCall).toHaveBeenNthCalledWith(2, 'compiler', '/simulate', {
      method: 'POST',
      body: { ir: { irVersion: '1.0.0' }, scenario },
      timeoutMs: 15000,
    })
  })

  it('returns compile errors without a result and does not simulate', async () => {
    mockCall.mockResolvedValueOnce(Response.json({ diagnostics: [diagnostic('TYPE_MISMATCH')] }))
    const body = await (
      await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})
    ).json()
    expect(body).toEqual({ diagnostics: [diagnostic('TYPE_MISMATCH')] })
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('auth, bad scenario and outages', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})).status).toBe(
      401
    )
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    expect(
      (await POST(createMockRequest('POST', { graph, scenario: { name: 'x' } }, {}, url), {}))
        .status
    ).toBe(400)
    mockCall.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    expect((await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})).status).toBe(
      503
    )
    mockCall.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect((await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})).status).toBe(
      502
    )
    mockCall
      .mockResolvedValueOnce(Response.json({ diagnostics: [], ir: {} }))
      .mockResolvedValueOnce(new Response('oops', { status: 500 }))
    expect((await POST(createMockRequest('POST', { graph, scenario }, {}, url), {})).status).toBe(
      502
    )
  })
})
