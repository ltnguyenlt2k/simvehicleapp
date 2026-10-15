import { type NextRequest, NextResponse } from 'next/server'
import { svCapacityContract, svCapacitySchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  orchestrator,
  upstreamError,
  workspaceAppCount,
  workspaceAppLimit,
} from '@/lib/sv/projects'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export const dynamic = 'force-dynamic'

/**
 * Host capacity for the Vehicle apps page and System status (ADR-0053): free disk and its threshold level, apps on
 * the host and in this workspace against their quotas, SynCode runs waiting.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svCapacityContract, request, {})
  if (!parsed.success) return parsed.response
  const { workspaceId } = parsed.data.query
  const access = await checkWorkspaceAccess(workspaceId, session.user.id)
  if (!access.hasAccess) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  const res = await orchestrator('/capacity')
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const body = res.body as {
    disk?: { freeBytes?: number; totalBytes?: number; level?: string } | null
    apps?: { total?: number; limit?: number }
    queue?: { queued?: number; limit?: number }
  } | null
  const capacity = svCapacitySchema.safeParse({
    disk: body?.disk
      ? { freeBytes: body.disk.freeBytes, totalBytes: body.disk.totalBytes, level: body.disk.level }
      : null,
    host: { apps: body?.apps?.total, limit: body?.apps?.limit },
    workspace: { apps: await workspaceAppCount(workspaceId), limit: workspaceAppLimit() },
    queue: { queued: body?.queue?.queued, limit: body?.queue?.limit },
  })
  if (!capacity.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid answer' }, { status: 502 })
  }
  return NextResponse.json(capacity.data)
})
