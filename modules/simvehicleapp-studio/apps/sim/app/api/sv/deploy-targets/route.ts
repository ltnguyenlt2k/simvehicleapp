import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import {
  svCreateDeployTargetContract,
  svDeployTargetListSchema,
  svDeployTargetSchema,
  svListDeployTargetsContract,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeWorkspace, orchestrator, upstreamError } from '@/lib/sv/projects'

const logger = createLogger('SvDeployTargetsAPI')

export const dynamic = 'force-dynamic'

/** The workspace's deploy targets (ADR-0060): databrokers outside the stack; tokens never come back. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? ''
  const auth = await authorizeWorkspace(workspaceId, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svListDeployTargetsContract, request, {})
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/deploy-targets?workspaceId=${encodeURIComponent(workspaceId)}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const list = svDeployTargetListSchema.safeParse(res.body)
  return NextResponse.json(list.success ? list.data : { targets: [] })
})

/** Adds a deploy target (workspace admins); the token is sealed by the orchestrator. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const parsed = await parseRequest(svCreateDeployTargetContract, request, {})
  if (!parsed.success) return parsed.response
  const body = parsed.data.body
  const auth = await authorizeWorkspace(body.workspaceId, 'admin')
  if (auth instanceof NextResponse) return auth
  const res = await orchestrator('/deploy-targets', { method: 'POST', body })
  if (res instanceof NextResponse) return res
  if (res.status === 409)
    return NextResponse.json(
      { error: `A deploy target named ${body.name} exists` },
      { status: 409 }
    )
  if (res.status !== 201) return upstreamError(res)
  const target = svDeployTargetSchema.safeParse(res.body)
  if (!target.success)
    return NextResponse.json({ error: 'Unexpected orchestrator answer' }, { status: 502 })
  logger.info('Deploy target added', { workspaceId: body.workspaceId, target: target.data.id })
  return NextResponse.json(target.data, { status: 201 })
})
