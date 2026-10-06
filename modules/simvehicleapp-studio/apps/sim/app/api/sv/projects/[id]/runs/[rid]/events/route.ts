import { type NextRequest, NextResponse } from 'next/server'
import { svRunEventsContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, runOf } from '@/lib/sv/projects'
import { relaySse } from '@/lib/sv/sse-relay'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; rid: string }> }

/** Log and trace of a run as SSE (`log`/`trace`, `id:` = seq; reload resumes with `Last-Event-ID`). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svRunEventsContract, request, context)
  if (!parsed.success) return parsed.response
  const run = await runOf(auth.row.id, parsed.data.params.rid)
  if (run instanceof NextResponse) return run
  return relaySse('orchestrator', `/events?runId=${encodeURIComponent(run.id)}`, request)
})
