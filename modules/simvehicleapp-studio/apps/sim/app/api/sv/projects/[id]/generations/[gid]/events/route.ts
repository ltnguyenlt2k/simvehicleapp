import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svGenerationEventsContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

const logger = createLogger('SvGenerationEventsAPI')

export const dynamic = 'force-dynamic'

/** A SynCode build can take minutes (first `conan install`); the stream ends with the generation. */
const STREAM_TIMEOUT_MS = 30 * 60 * 1000

type RouteContext = { params: Promise<{ id: string; gid: string }> }

/**
 * Build log of a generation as SSE (LogLine v1, `id:` = seq): relayed from the orchestrator's
 * `/events`, resumable with `Last-Event-ID`; closes when the generation ends or the client leaves.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svGenerationEventsContract, request, context)
  if (!parsed.success) return parsed.response
  const gid = encodeURIComponent(parsed.data.params.gid)

  const owned = await orchestrator(`/projects/${auth.row.id}/generations/${gid}`)
  if (owned instanceof NextResponse) return owned
  if (owned.status !== 200) return upstreamError(owned)

  const lastEventId = request.headers.get('last-event-id')
  let upstream: Response
  try {
    upstream = await callSvService('orchestrator', `/events?generationId=${gid}`, {
      timeoutMs: STREAM_TIMEOUT_MS,
      signal: request.signal,
      headers: {
        accept: 'text/event-stream',
        ...(lastEventId && /^-?\d+$/.test(lastEventId) ? { 'last-event-id': lastEventId } : {}),
      },
    })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'Orchestrator is not configured' }, { status: 503 })
    }
    logger.warn('orchestrator events unreachable', { generation: gid })
    return NextResponse.json({ error: 'Orchestrator is unavailable' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'Orchestrator error' }, { status: 502 })
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
})
