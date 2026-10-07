/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnv, mockFetch } = vi.hoisted(() => ({
  mockEnv: {
    INTERNAL_API_SECRET: 'internal-secret-0123456789abcdef0123456789',
    SV_CATALOG_URL: undefined as string | undefined,
    SV_COMPILER_URL: undefined as string | undefined,
    SV_ORCHESTRATOR_URL: undefined as string | undefined,
    SV_SIGNAL_GATEWAY_URL: undefined as string | undefined,
    SV_AI_URL: undefined as string | undefined,
  },
  mockFetch: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({ env: mockEnv, getEnv: () => undefined }))

import { generateRequestId } from '@/lib/core/utils/request'
import {
  callSvService,
  checkSvServiceHealth,
  getSvServiceUrl,
  SvServiceNotConfiguredError,
} from '@/lib/sv/api-client'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('sv api-client (M01-T09)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    mockEnv.SV_CATALOG_URL = undefined
    mockEnv.SV_COMPILER_URL = undefined
    vi.unstubAllGlobals()
  })

  it('reads service URLs from SV_*_URL and trims trailing slashes', () => {
    mockEnv.SV_CATALOG_URL = 'http://vss-catalog:4010/'
    expect(getSvServiceUrl('vss-catalog')).toBe('http://vss-catalog:4010')
    expect(getSvServiceUrl('compiler')).toBeUndefined()
  })

  it('sends the internal auth and request id headers', async () => {
    mockEnv.SV_COMPILER_URL = 'http://compiler:4020'
    mockFetch.mockResolvedValue(json({ ok: true }))
    await callSvService('compiler', 'compile', { method: 'POST', body: { a: 1 } })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://compiler:4020/compile')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers['x-sv-internal']).toBe(mockEnv.INTERNAL_API_SECRET)
    expect(init.headers['x-sv-request-id']).toBe(generateRequestId())
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('retries a pure call once when a pooled connection was reset (service restarted)', async () => {
    mockEnv.SV_COMPILER_URL = 'http://compiler:4020'
    const reset = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'UND_ERR_SOCKET' },
    })
    mockFetch.mockRejectedValueOnce(reset).mockResolvedValueOnce(json({ diagnostics: [] }))
    const res = await callSvService('compiler', '/lint', {
      method: 'POST',
      body: {},
      retryOnReset: true,
    })
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    mockFetch.mockReset()
    mockFetch.mockRejectedValueOnce(reset)
    await expect(callSvService('compiler', '/lint', { method: 'POST', body: {} })).rejects.toBe(
      reset
    )
    expect(mockFetch).toHaveBeenCalledTimes(1)

    mockFetch.mockReset()
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: { code: 'ECONNREFUSED' },
    })
    mockFetch.mockRejectedValue(refused)
    await expect(
      callSvService('compiler', '/lint', { method: 'POST', retryOnReset: true })
    ).rejects.toBe(refused)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('refuses to call an unconfigured service', async () => {
    await expect(callSvService('orchestrator', '/x')).rejects.toBeInstanceOf(
      SvServiceNotConfiguredError
    )
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('maps /healthz results to ok, degraded, down and unconfigured', async () => {
    expect(await checkSvServiceHealth('ai-assistant')).toEqual({
      service: 'ai-assistant',
      status: 'unconfigured',
    })

    mockEnv.SV_CATALOG_URL = 'http://vss-catalog:4010'
    mockFetch.mockResolvedValueOnce(json({ status: 'ok' }))
    expect(await checkSvServiceHealth('vss-catalog')).toMatchObject({ status: 'ok' })

    mockFetch.mockResolvedValueOnce(json({ status: 'degraded' }, 503))
    expect(await checkSvServiceHealth('vss-catalog')).toMatchObject({
      status: 'degraded',
      error: 'HTTP 503',
    })

    mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    expect(await checkSvServiceHealth('vss-catalog')).toMatchObject({
      status: 'down',
      error: 'connect ECONNREFUSED',
    })
  })
})
