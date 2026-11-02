import { db } from '@sim/db'
import { svWorkflowSettings } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type SvWorkflowSettings,
  svGetWorkflowSettingsContract,
  svUpdateWorkflowSettingsContract,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchCatalogReleases } from '@/lib/sv/catalog-proxy'

const logger = createLogger('SvWorkflowSettingsAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Session + workspace permission on the workflow; returns an error response or null. */
async function authorize(
  workflowId: string,
  action: 'read' | 'write'
): Promise<NextResponse | null> {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: session.user.id,
    action,
  })
  if (!authorization.workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.message || 'Access denied' },
      { status: authorization.status || 403 }
    )
  }
  return null
}

/** VSS release the workflow is pinned to; `null` = catalog default (M02-T11, ADR-0010 §3). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const workflowId = (await context.params).id
  const denied = await authorize(workflowId, 'read')
  if (denied) return denied

  const parsed = await parseRequest(svGetWorkflowSettingsContract, request, context)
  if (!parsed.success) return parsed.response

  const [row] = await db
    .select({ vssRelease: svWorkflowSettings.vssRelease, domain: svWorkflowSettings.domain })
    .from(svWorkflowSettings)
    .where(eq(svWorkflowSettings.workflowId, parsed.data.params.id))
    .limit(1)
  const body: SvWorkflowSettings = {
    vssRelease: row?.vssRelease || null,
    domain: row?.domain === 'robot' ? 'robot' : 'vehicle',
  }
  return NextResponse.json(body)
})

/** Pins the workflow to a VSS release (only releases vss-catalog serves), or makes it a robot workflow (RSS). */
export const PUT = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const workflowId = (await context.params).id
  const denied = await authorize(workflowId, 'write')
  if (denied) return denied

  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const parsed = await parseRequest(svUpdateWorkflowSettingsContract, request, context)
  if (!parsed.success) return parsed.response
  const { vssRelease, domain } = parsed.data.body
  const id = parsed.data.params.id

  if (domain === 'robot') {
    // A robot workflow keeps the VSS release it had (if any) for when it turns back into a vehicle one.
    await db
      .insert(svWorkflowSettings)
      .values({ workflowId: id, vssRelease: '', domain, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: svWorkflowSettings.workflowId,
        set: { domain, updatedAt: new Date() },
      })
    const [row] = await db
      .select({ vssRelease: svWorkflowSettings.vssRelease })
      .from(svWorkflowSettings)
      .where(eq(svWorkflowSettings.workflowId, id))
      .limit(1)
    logger.info('Workflow set to the robot domain', { workflowId })
    const body: SvWorkflowSettings = { vssRelease: row?.vssRelease || null, domain }
    return NextResponse.json(body)
  }

  const release = vssRelease as string
  const releases = await fetchCatalogReleases()
  if (releases === null) {
    return NextResponse.json({ error: 'VSS catalog is unavailable' }, { status: 502 })
  }
  if (!releases.includes(release)) {
    return NextResponse.json(
      { error: `VSS release ${release} is not available (available: ${releases.join(', ')})` },
      { status: 400 }
    )
  }

  await db
    .insert(svWorkflowSettings)
    .values({ workflowId: id, vssRelease: release, domain, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: svWorkflowSettings.workflowId,
      set: { vssRelease: release, domain, updatedAt: new Date() },
    })
  logger.info('VSS release pinned', { workflowId, vssRelease: release })

  const body: SvWorkflowSettings = { vssRelease: release, domain }
  return NextResponse.json(body)
})
