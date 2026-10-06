import { type NextRequest, NextResponse } from 'next/server'
import { svRunSchema, svStopRunContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, runOf, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; rid: string }> }

/** Stop (SIGINT, SIGKILL after 5 s). */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svStopRunContract, request, context)
  if (!parsed.success) return parsed.response
  const run = await runOf(auth.row.id, parsed.data.params.rid)
  if (run instanceof NextResponse) return run
  const res = await orchestrator(`/runs/${encodeURIComponent(run.id)}/stop`, { method: 'POST' })
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const stopped = svRunSchema.safeParse(res.body)
  return stopped.success
    ? NextResponse.json(stopped.data)
    : NextResponse.json({ error: 'Orchestrator returned an invalid run' }, { status: 502 })
})
