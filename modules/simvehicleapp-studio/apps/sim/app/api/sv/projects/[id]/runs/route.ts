import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type SvRun,
  svListRunsContract,
  svRunSchema,
  svStartRunContract,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

const logger = createLogger('SvRunsAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Recent runs of the project, newest first (M08-T08). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svListRunsContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/runs?projectId=${encodeURIComponent(auth.row.id)}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const runs = ((res.body as { runs?: unknown[] } | null)?.runs ?? []).flatMap((r) => {
    const v = svRunSchema.safeParse(r)
    return v.success ? [v.data] : []
  })
  return NextResponse.json({ runs })
})

/**
 * Run (M08-T03): the app of the project's latest SynCode on the runtime stack. One run at a time on
 * the stack; when another project's run is active its details stay hidden (other workspaces).
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svStartRunContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/runs`, {
    method: 'POST',
    body: parsed.data.body,
  })
  if (res instanceof NextResponse) return res
  if (res.status === 409) {
    const body = res.body as { message?: string; activeRun?: SvRun } | null
    const own = body?.activeRun?.projectId === auth.row.id
    return NextResponse.json(
      {
        error: own
          ? (body?.message ?? 'A run of this project is active')
          : body?.activeRun
            ? 'Another project is running on the vehicle stack: try again when it stops'
            : (body?.message ?? 'The project cannot run now'),
      },
      { status: 409 }
    )
  }
  if (res.status !== 202) return upstreamError(res)
  const run = svRunSchema.safeParse(res.body)
  if (!run.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid run' }, { status: 502 })
  }
  logger.info('run started', { project: auth.row.slug, run: run.data.id })
  return NextResponse.json(run.data, { status: 202 })
})
