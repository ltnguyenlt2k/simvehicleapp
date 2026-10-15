import { db } from '@sim/db'
import { svProjects } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { svDeleteProjectContract, svGetProjectContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, parseProject, upstreamError } from '@/lib/sv/projects'

const logger = createLogger('SvProjectAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** One project (status `creating` → `ready`/`failed` while its folder is prepared). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svGetProjectContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const project = parseProject(res.body)
  if (!project.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  return NextResponse.json(project.data)
})

/**
 * Deletes the vehicle app (ADR-0053): the orchestrator stops its run, removes its folder, caches and history; then
 * the workspace link goes. A building SynCode answers 409. An app the orchestrator no longer has is unlinked too.
 */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svDeleteProjectContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}`, { method: 'DELETE', timeoutMs: 30000 })
  if (res instanceof NextResponse) return res
  if (res.status !== 204 && res.status !== 404) return upstreamError(res)
  await db.delete(svProjects).where(eq(svProjects.id, auth.row.id))
  logger.info('vehicle app deleted', { slug: auth.row.slug, workspaceId: auth.row.workspaceId })
  return NextResponse.json({ deleted: true as const })
})
