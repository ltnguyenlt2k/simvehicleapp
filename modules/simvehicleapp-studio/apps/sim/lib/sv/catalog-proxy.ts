import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvCatalogProxy')

/** vss-catalog statuses passed through to the browser; anything else becomes 502. */
const PASSTHROUGH_ERRORS = new Set([400, 404])

/**
 * Forwards a validated catalog query to vss-catalog (ADR-0007: the browser only talks to the BFF).
 * Undefined query values are dropped. Upstream 400/404 keep their status and `error`; an unconfigured
 * catalog is 503; an unreachable or failing catalog is 502 without upstream details.
 */
export async function forwardCatalogRequest(
  path: '/releases' | '/tree' | '/search' | '/nodes',
  query: Record<string, string | number | undefined> = {}
): Promise<NextResponse> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const qs = params.toString()
  let upstream: Response
  try {
    upstream = await callSvService('vss-catalog', qs ? `${path}?${qs}` : path)
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'VSS catalog is not configured' }, { status: 503 })
    }
    logger.warn('vss-catalog unreachable', { path, error: getErrorMessage(error, 'unreachable') })
    return NextResponse.json({ error: 'VSS catalog is unavailable' }, { status: 502 })
  }

  const payload = (await upstream.json().catch(() => null)) as Record<string, unknown> | null
  if (upstream.ok && payload) return NextResponse.json(payload)
  if (PASSTHROUGH_ERRORS.has(upstream.status)) {
    const message =
      typeof payload?.message === 'string' ? payload.message : String(payload?.error ?? 'error')
    return NextResponse.json({ error: message }, { status: upstream.status })
  }
  logger.warn('vss-catalog error', { path, status: upstream.status })
  return NextResponse.json({ error: 'VSS catalog is unavailable' }, { status: 502 })
}

/** Release tags served by vss-catalog, or `null` when the catalog cannot be reached. */
export async function fetchCatalogReleases(): Promise<string[] | null> {
  try {
    const res = await callSvService('vss-catalog', '/releases')
    if (!res.ok) return null
    const body = (await res.json()) as { releases?: { release?: unknown }[] }
    return (body.releases ?? [])
      .map((r) => r.release)
      .filter((r): r is string => typeof r === 'string')
  } catch (error) {
    logger.warn('vss-catalog releases unavailable', {
      error: getErrorMessage(error, 'unreachable'),
    })
    return null
  }
}
