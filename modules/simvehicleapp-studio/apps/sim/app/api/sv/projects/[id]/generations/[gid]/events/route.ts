import { type NextRequest, NextResponse } from 'next/server'
import { svGenerationEventsContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'
import { relaySse } from '@/lib/sv/sse-relay'

export const dynamic = 'force-dynamic'

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
  return relaySse('orchestrator', `/events?generationId=${gid}`, request)
})
