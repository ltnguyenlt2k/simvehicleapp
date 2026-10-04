/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCall } = vi.hoisted(() => ({ mockCall: vi.fn() }))

vi.mock('@/lib/sv/api-client', () => {
  class SvServiceNotConfiguredError extends Error {}
  return { callSvService: mockCall, SvServiceNotConfiguredError }
})

import { SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { forwardCatalogRequest } from '@/lib/sv/catalog-proxy'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('forwardCatalogRequest (M02-T12)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds the query string without undefined values and passes the body through', async () => {
    const body = {
      release: 'v4.0',
      nodes: [{ path: 'Vehicle.Speed', name: 'Speed', kind: 'sensor' }],
    }
    mockCall.mockResolvedValue(json(200, body))
    const res = await forwardCatalogRequest('/tree', {
      prefix: 'Vehicle.Cabin',
      depth: 2,
      release: undefined,
    })
    expect(mockCall).toHaveBeenCalledWith('vss-catalog', '/tree?prefix=Vehicle.Cabin&depth=2')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(body)
  })

  it('omits the query string when there is none', async () => {
    mockCall.mockResolvedValue(json(200, { releases: [] }))
    await forwardCatalogRequest('/releases')
    expect(mockCall).toHaveBeenCalledWith('vss-catalog', '/releases')
  })

  it.each([
    [
      400,
      { error: 'invalid_request', message: 'depth must be between 1 and 16' },
      'depth must be between 1 and 16',
    ],
    [404, { error: 'unknown_release', message: 'unknown release v9.9' }, 'unknown release v9.9'],
  ])('keeps upstream %i with its message', async (status, body, message) => {
    mockCall.mockResolvedValue(json(status, body))
    const res = await forwardCatalogRequest('/tree', { release: 'v9.9' })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: message })
  })

  it('hides upstream 5xx and auth failures behind 502', async () => {
    for (const status of [401, 500, 503]) {
      mockCall.mockResolvedValue(json(status, { error: 'release_unavailable' }))
      const res = await forwardCatalogRequest('/search', { q: 'speed' })
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'VSS catalog is unavailable' })
    }
  })

  it('maps network errors to 502 and a missing SV_CATALOG_URL to 503', async () => {
    mockCall.mockRejectedValue(new Error('ECONNREFUSED'))
    expect((await forwardCatalogRequest('/releases')).status).toBe(502)
    mockCall.mockRejectedValue(new SvServiceNotConfiguredError('vss-catalog'))
    expect((await forwardCatalogRequest('/releases')).status).toBe(503)
  })
})
