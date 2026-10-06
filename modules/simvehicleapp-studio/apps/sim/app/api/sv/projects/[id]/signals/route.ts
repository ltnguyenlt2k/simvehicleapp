import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  svSetSignalContract,
  svSignalStreamContract,
  svSignalUpdateSchema,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, projectOf, svJson, upstreamError } from '@/lib/sv/projects'
import { relaySse } from '@/lib/sv/sse-relay'

const logger = createLogger('SvSignalsAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Signals panel (M08-T08): current values and actuator targets on the databroker of the project's
 * VSS release, streamed from the signal-gateway (paths are checked against the release catalog there).
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svSignalStreamContract, request, context)
  if (!parsed.success) return parsed.response
  const project = await projectOf(auth.row.id)
  if (project instanceof NextResponse) return project
  const query = new URLSearchParams({ release: project.vssRelease, paths: parsed.data.query.paths })
  return relaySse('signal-gateway', `/signals?${query}`, request)
})

/** Inject: a sensor's current value, or an actuator's target (or current value). */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svSetSignalContract, request, context)
  if (!parsed.success) return parsed.response
  const project = await projectOf(auth.row.id)
  if (project instanceof NextResponse) return project
  const res = await svJson('signal-gateway', '/signals', {
    method: 'POST',
    body: { release: project.vssRelease, ...parsed.data.body },
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const update = svSignalUpdateSchema.safeParse(res.body)
  if (!update.success) {
    return NextResponse.json(
      { error: 'Signal gateway returned an invalid update' },
      { status: 502 }
    )
  }
  logger.info('signal injected', { project: auth.row.slug, path: update.data.path })
  return NextResponse.json(update.data)
})
