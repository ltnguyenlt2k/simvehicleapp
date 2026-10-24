import { type NextRequest, NextResponse } from 'next/server'
import { svDeleteDeployTargetContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeWorkspace, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Removes a deploy target (workspace admins); refused while apps are deployed to it. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const parsed = await parseRequest(svDeleteDeployTargetContract, request, context)
  if (!parsed.success) return parsed.response
  const { id } = parsed.data.params
  const { workspaceId } = parsed.data.query
  const auth = await authorizeWorkspace(workspaceId, 'admin')
  if (auth instanceof NextResponse) return auth
  const res = await orchestrator(
    `/deploy-targets/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE' }
  )
  if (res instanceof NextResponse) return res
  if (res.status === 409) {
    const message = (res.body as { message?: string } | null)?.message
    return NextResponse.json(
      { error: message ?? 'Apps are deployed to this target' },
      { status: 409 }
    )
  }
  if (res.status === 404)
    return NextResponse.json({ error: 'Deploy target not found' }, { status: 404 })
  if (res.status !== 204) return upstreamError(res)
  return NextResponse.json({ deleted: true })
})
