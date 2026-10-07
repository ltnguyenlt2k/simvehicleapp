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

import { SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { POST } from '@/app/api/sv/lint/route'

const url = 'http://localhost:3000/api/sv/lint'
const graph = { graphVersion: '1.0.0', workflowId: 'wf', blocks: [] }
const diagnostic = {
  code: 'BLOCK_UNREACHABLE',
  severity: 'warning',
  stage: 'control-flow',
  blockId: 'b1',
  message: 'Read never runs',
  docs: 'diagnostics#BLOCK_UNREACHABLE',
}

describe('POST /api/sv/lint (M03-T11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('requires a session and a graph object', async () => {
    mockGetSession.mockResolvedValue(null)
    expect((await POST(createMockRequest('POST', { graph }, {}, url), {})).status).toBe(401)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    expect((await POST(createMockRequest('POST', { graph: 'x' }, {}, url), {})).status).toBe(400)
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('forwards the graph and returns the compiler diagnostics', async () => {
    mockCall.mockResolvedValue(Response.json({ diagnostics: [diagnostic] }))
    const res = await POST(createMockRequest('POST', { graph }, {}, url), {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ diagnostics: [diagnostic] })
    expect(mockCall).toHaveBeenCalledWith('compiler', '/lint', {
      method: 'POST',
      retryOnReset: true,
      body: { graph },
      timeoutMs: 5000,
    })
  })

  it('maps outages: catalog 503, compiler errors/garbage 502, unconfigured 503', async () => {
    mockCall.mockResolvedValue(new Response('', { status: 503 }))
    expect((await POST(createMockRequest('POST', { graph }, {}, url), {})).status).toBe(503)
    mockCall.mockResolvedValue(Response.json({ nope: true }))
    expect((await POST(createMockRequest('POST', { graph }, {}, url), {})).status).toBe(502)
    mockCall.mockRejectedValue(new Error('ECONNREFUSED'))
    expect((await POST(createMockRequest('POST', { graph }, {}, url), {})).status).toBe(502)
    mockCall.mockRejectedValue(new SvServiceNotConfiguredError('compiler'))
    expect((await POST(createMockRequest('POST', { graph }, {}, url), {})).status).toBe(503)
  })
})
