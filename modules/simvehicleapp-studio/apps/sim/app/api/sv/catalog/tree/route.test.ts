/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockForward } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockForward: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/sv/catalog-proxy', () => ({ forwardCatalogRequest: mockForward }))

import { NextResponse } from 'next/server'
import { GET as getNodes } from '@/app/api/sv/catalog/nodes/route'
import { GET as getSearch } from '@/app/api/sv/catalog/search/route'
import { GET as getTree } from '@/app/api/sv/catalog/tree/route'

const req = (url: string) => createMockRequest('GET', undefined, {}, `http://localhost:3000${url}`)

describe('GET /api/sv/catalog/* (M02-T12)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockForward.mockResolvedValue(NextResponse.json({ release: 'v4.0', nodes: [] }))
  })

  it('requires a session before validating or forwarding', async () => {
    mockGetSession.mockResolvedValue(null)
    const res = await getTree(req('/api/sv/catalog/tree?depth=abc'), {})
    expect(res.status).toBe(401)
    expect(mockForward).not.toHaveBeenCalled()
  })

  it('forwards the parsed tree query (depth coerced to a number)', async () => {
    const res = await getTree(
      req('/api/sv/catalog/tree?prefix=Vehicle.Cabin&depth=2&release=v4.2'),
      {}
    )
    expect(res.status).toBe(200)
    expect(mockForward).toHaveBeenCalledWith('/tree', {
      prefix: 'Vehicle.Cabin',
      depth: 2,
      release: 'v4.2',
    })
  })

  it.each([
    '/api/sv/catalog/tree?depth=0',
    '/api/sv/catalog/tree?prefix=Vehicle',
    '/api/sv/catalog/tree?release=4.0',
  ])('rejects %s with 400 without calling the catalog', async (url) => {
    const res = await getTree(req(url), {})
    expect(res.status).toBe(400)
    expect(mockForward).not.toHaveBeenCalled()
  })

  it('search requires q and a valid kind', async () => {
    expect((await getSearch(req('/api/sv/catalog/search'), {})).status).toBe(400)
    expect((await getSearch(req('/api/sv/catalog/search?q=speed&type=signal'), {})).status).toBe(
      400
    )
    expect((await getSearch(req('/api/sv/catalog/search?q=speed&type=sensor'), {})).status).toBe(
      200
    )
    expect(mockForward).toHaveBeenCalledWith('/search', { q: 'speed', type: 'sensor' })
  })

  it('nodes validates every comma-separated path', async () => {
    expect(
      (await getNodes(req('/api/sv/catalog/nodes?paths=Vehicle.Speed,Vehicle'), {})).status
    ).toBe(400)
    expect(
      (await getNodes(req('/api/sv/catalog/nodes?paths=Vehicle.Speed,Vehicle.IsMoving'), {})).status
    ).toBe(200)
    expect(mockForward).toHaveBeenCalledWith('/nodes', { paths: 'Vehicle.Speed,Vehicle.IsMoving' })
  })
})
