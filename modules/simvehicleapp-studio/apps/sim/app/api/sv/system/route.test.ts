/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockCall, mockHealth } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCall: vi.fn(),
  mockHealth: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))
vi.mock('@/lib/sv/api-client', () => ({
  SV_SERVICES: ['compiler', 'orchestrator'],
  callSvService: mockCall,
  checkSvServiceHealth: mockHealth,
}))

import { GET } from '@/app/api/sv/system/route'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('GET /api/sv/system (M11-T05)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
  })

  it('401 without a session', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    expect((await GET(createMockRequest('GET'))).status).toBe(401)
  })

  it('services the studio calls (health + version) and those the orchestrator drives', async () => {
    mockHealth.mockImplementation(async (service: string) =>
      service === 'compiler'
        ? { service, status: 'ok', latencyMs: 3 }
        : { service, status: 'down', latencyMs: 2000, error: 'timeout' }
    )
    mockCall.mockImplementation(async (service: string, path: string) => {
      if (path === '/version' && service === 'compiler')
        return json({
          name: 'compiler',
          version: '0.4.0',
          commit: 'abc',
          contracts: '1.0.0-alpha.1',
        })
      if (path === '/version') throw new Error('unreachable')
      if (path === '/system')
        return json({
          services: [
            { service: 'toolchain-cpp', status: 'ok', version: '0.2.0', latencyMs: 5 },
            { service: 'bogus', status: 'weird' },
          ],
        })
      throw new Error(`unexpected ${service} ${path}`)
    })
    const res = await GET(createMockRequest('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.studio.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(body.services).toEqual([
      {
        service: 'compiler',
        status: 'ok',
        latencyMs: 3,
        version: '0.4.0',
        commit: 'abc',
        contracts: '1.0.0-alpha.1',
        via: 'studio',
      },
      { service: 'orchestrator', status: 'down', latencyMs: 2000, error: 'timeout', via: 'studio' },
      {
        service: 'toolchain-cpp',
        status: 'ok',
        version: '0.2.0',
        latencyMs: 5,
        via: 'orchestrator',
      },
    ])
  })
})
