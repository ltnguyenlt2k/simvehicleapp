/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

import { GET } from '@/app/api/sv/ide/authorize/route'

describe('GET /api/sv/ide/authorize (M21 D15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lets a signed-in user through, never cached', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    const res = await GET(createMockRequest('GET'), {})
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('refuses a request without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await GET(createMockRequest('GET'), {})
    expect(res.status).toBe(401)
  })
})
