import { db } from '@sim/db'
import { svProjects } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { svCreateProjectContract, svListProjectsContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { orchestrator, parseProject, upstreamError, workflowsInWorkspace } from '@/lib/sv/projects'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SvProjectsAPI')

export const dynamic = 'force-dynamic'

/** Vehicle-app projects of a workspace (M07-T17): the orchestrator's projects linked in `sv_projects`. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svListProjectsContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId } = parsed.data.query
  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.hasAccess) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const rows = await db
    .select({ id: svProjects.id })
    .from(svProjects)
    .where(eq(svProjects.workspaceId, workspaceId))
  if (rows.length === 0) return NextResponse.json({ projects: [] })
  const res = await orchestrator('/projects')
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const ids = new Set(rows.map((r) => r.id))
  const all = (res.body as { projects?: unknown[] } | null)?.projects ?? []
  const projects = all.flatMap((p) => {
    const v = parseProject(p)
    return v.success && ids.has(v.data.id) ? [v.data] : []
  })
  return NextResponse.json({ projects })
})

/**
 * Creates a C++ or Python project for the workspace: the orchestrator creates it (the folder is prepared in
 * the background, `status: creating`), the studio links it to the workspace and assigns workflows.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svCreateProjectContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId, name, slug, vssRelease, workflowIds, language } = parsed.data.body
  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.hasAccess) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  if (!access.canWrite) return NextResponse.json({ error: 'Access denied' }, { status: 403 })

  const created = await orchestrator('/projects', {
    method: 'POST',
    body: { slug, name, language, vssRelease },
  })
  if (created instanceof NextResponse) return created
  if (created.status !== 201) return upstreamError(created)
  const project = parseProject(created.body)
  if (!project.success) {
    logger.warn('orchestrator project does not match the contract')
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  await db
    .insert(svProjects)
    .values({ id: project.data.id, workspaceId, slug, createdBy: session.user.id })
  logger.info('project created', { slug, workspaceId })

  const ids = await workflowsInWorkspace(workspaceId, workflowIds)
  if (ids.length === 0) return NextResponse.json(project.data)
  const assigned = await orchestrator(`/projects/${project.data.id}/workflows`, {
    method: 'PUT',
    body: { workflows: ids.map((simWorkflowId) => ({ simWorkflowId, enabled: true })) },
  })
  if (assigned instanceof NextResponse) return assigned
  const withWorkflows = parseProject(assigned.body)
  return NextResponse.json(withWorkflows.success ? withWorkflows.data : project.data)
})
