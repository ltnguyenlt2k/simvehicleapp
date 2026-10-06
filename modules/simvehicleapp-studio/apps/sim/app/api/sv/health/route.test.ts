/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCheck } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCheck: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/sv/api-client', () => ({
  SV_SERVICES: ['vss-catalog', 'compiler', 'orchestrator', 'signal-gateway', 'ai-assistant'],
  checkSvServiceHealth: mockCheck,
}))

import { svHealthResponseSchema } from '@/lib/api/contracts/sv'
import { GET } from '@/app/api/sv/health/route'

describe('GET /api/sv/health (M01-T09)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('requires a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(createMockRequest('GET'), {})
    expect(res.status).toBe(401)
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it('is ok when every service is ok or not configured yet', async () => {
    mockCheck.mockImplementation(async (service: string) =>
      service === 'compiler'
        ? { service, status: 'ok', latencyMs: 3 }
        : { service, status: 'unconfigured' }
    )
    const res = await GET(createMockRequest('GET'), {})
    expect(res.status).toBe(200)
    const body = svHealthResponseSchema.parse(await res.json())
    expect(body.status).toBe('ok')
    expect(body.services.map((s) => s.service)).toEqual([
      'vss-catalog',
      'compiler',
      'orchestrator',
      'signal-gateway',
      'ai-assistant',
    ])
  })

  it('is degraded when a configured service is down', async () => {
    mockCheck.mockImplementation(async (service: string) =>
      service === 'orchestrator'
        ? { service, status: 'down', error: 'timeout' }
        : { service, status: 'ok' }
    )
    const body = svHealthResponseSchema.parse(
      await (await GET(createMockRequest('GET'), {})).json()
    )
    expect(body.status).toBe('degraded')
  })
})
