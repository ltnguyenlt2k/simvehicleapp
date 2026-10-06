import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { callSvService, type SvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvSseRelay')

/** A SynCode build or a live run streams for minutes to hours; the stream also ends with the client. */
const STREAM_TIMEOUT_MS = 12 * 60 * 60 * 1000

/**
 * Relays an SSE stream of an internal service to the browser (log, trace, signals): `Last-Event-ID`
 * goes upstream so a reconnecting EventSource resumes where it stopped.
 */
export async function relaySse(
  service: SvService,
  path: string,
  request: Request
): Promise<Response> {
  const lastEventId = request.headers.get('last-event-id')
  let upstream: Response
  try {
    upstream = await callSvService(service, path, {
      timeoutMs: STREAM_TIMEOUT_MS,
      signal: request.signal,
      headers: {
        accept: 'text/event-stream',
        ...(lastEventId && /^-?\d+$/.test(lastEventId) ? { 'last-event-id': lastEventId } : {}),
      },
    })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: `${service} is not configured` }, { status: 503 })
    }
    logger.warn('stream unreachable', { service })
    return NextResponse.json({ error: `${service} is unavailable` }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null
    const status = upstream.status === 400 || upstream.status === 404 ? upstream.status : 502
    return NextResponse.json({ error: body?.message ?? `${service} error` }, { status })
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}
