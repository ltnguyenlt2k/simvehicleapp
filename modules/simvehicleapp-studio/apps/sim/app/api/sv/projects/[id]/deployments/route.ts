import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svDiagnosticSchema, svRunSchema, svStartDeploymentContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeProject,
  authorizeWorkspace,
  orchestrator,
  upstreamError,
} from '@/lib/sv/projects'

const logger = createLogger('SvDeploymentsAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Deploys the app's latest SynCode to a deploy target (ADR-0060): it runs on the target's signals, simulated input is
 * disabled. Read-write (the app may set its actuators on the target) is for workspace admins only.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svStartDeploymentContract, request, context)
  if (!parsed.success) return parsed.response
  const { targetId, mode } = parsed.data.body
  if (mode === 'read-write') {
    const admin = await authorizeWorkspace(auth.row.workspaceId, 'admin')
    if (admin instanceof NextResponse) return admin
  }
  const res = await orchestrator(`/projects/${auth.row.id}/deployments`, {
    method: 'POST',
    body: { targetId, mode, owner: { userId: auth.userId, workspaceId: auth.row.workspaceId } },
  })
  if (res instanceof NextResponse) return res
  if (res.status === 409 && Array.isArray(res.body)) {
    const quota = svDiagnosticSchema.safeParse(res.body[0])
    return NextResponse.json(
      {
        error: quota.success ? quota.data.message : 'The deployment quota is reached',
        code: 'DEPLOY_QUOTA_EXCEEDED',
      },
      { status: 409 }
    )
  }
  if (res.status === 409 || res.status === 404) {
    const message = (res.body as { message?: string } | null)?.message
    return NextResponse.json(
      { error: message ?? 'The app cannot be deployed now' },
      { status: res.status }
    )
  }
  if (res.status !== 202) return upstreamError(res)
  const run = svRunSchema.safeParse(res.body)
  if (!run.success)
    return NextResponse.json({ error: 'Unexpected orchestrator answer' }, { status: 502 })
  logger.info('Deployment started', {
    project: auth.row.id,
    target: targetId,
    mode,
    run: run.data.id,
  })
  return NextResponse.json(run.data, { status: 202 })
})
