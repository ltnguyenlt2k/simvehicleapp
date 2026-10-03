/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockFetch } = vi.hoisted(() => ({
  mockEnv: { TELEMETRY_ENDPOINT: undefined as string | undefined, NODE_ENV: 'test' },
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: mockEnv,
  getEnv: (name: string) => process.env[name],
  isTruthy: (value: unknown) => value === true || value === 'true' || value === '1',
  isFalsy: (value: unknown) => value === false || value === 'false' || value === '0',
}))

vi.mock('@/lib/core/rate-limiter', () => ({
  enforceIpRateLimit: vi.fn().mockResolvedValue(null),
}))

import { POST } from '@/app/api/telemetry/route'

const event = { category: 'page_view', action: 'open' }

describe('POST /api/telemetry (M01-T07: no default collector)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockFetch.mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    mockEnv.TELEMETRY_ENDPOINT = undefined
    vi.unstubAllGlobals()
  })

  it('does not send anything outside without TELEMETRY_ENDPOINT', async () => {
    const res = await POST(createMockRequest('POST', event))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, forwarded: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('forwards only to the operator-configured collector', async () => {
    mockEnv.TELEMETRY_ENDPOINT = 'https://otel.example.com/v1/traces'
    const res = await POST(createMockRequest('POST', event))
    expect(await res.json()).toEqual({ success: true, forwarded: true })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(String(mockFetch.mock.calls[0][0])).toBe('https://otel.example.com/v1/traces')
  })
})
