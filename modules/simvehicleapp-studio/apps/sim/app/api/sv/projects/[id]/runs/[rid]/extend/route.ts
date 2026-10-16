import { type NextRequest, NextResponse } from 'next/server'
import { svExtendRunContract, svRunSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, runOf, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; rid: string }> }

/** Extend (ADR-0057): the run's time limit moves by `SV_RUN_MAX_MINUTES`, a few times at most. */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svExtendRunContract, request, context)
  if (!parsed.success) return parsed.response
  const run = await runOf(auth.row.id, parsed.data.params.rid)
  if (run instanceof NextResponse) return run
  const res = await orchestrator(`/runs/${encodeURIComponent(run.id)}/extend`, { method: 'POST' })
  if (res instanceof NextResponse) return res
  if (res.status === 409) {
    const message = (res.body as { message?: string } | null)?.message
    return NextResponse.json({ error: message ?? 'This run cannot be extended' }, { status: 409 })
  }
  if (res.status !== 200) return upstreamError(res)
  const extended = svRunSchema.safeParse(res.body)
  return extended.success
    ? NextResponse.json(extended.data)
    : NextResponse.json({ error: 'Orchestrator returned an invalid run' }, { status: 502 })
})
