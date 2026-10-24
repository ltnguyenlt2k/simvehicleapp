import { type NextRequest, NextResponse } from 'next/server'
import { svTestDeployTargetContract, svTestDeployTargetResultSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeWorkspace, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Test connection of a deploy target: its server and which of the given signals it lacks. */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const parsed = await parseRequest(svTestDeployTargetContract, request, context)
  if (!parsed.success) return parsed.response
  const auth = await authorizeWorkspace(parsed.data.body.workspaceId, 'write')
  if (auth instanceof NextResponse) return auth
  const res = await orchestrator(
    `/deploy-targets/${encodeURIComponent(parsed.data.params.id)}/test`,
    {
      method: 'POST',
      body: parsed.data.body,
      timeoutMs: 30_000,
    }
  )
  if (res instanceof NextResponse) return res
  if (res.status === 404)
    return NextResponse.json({ error: 'Deploy target not found' }, { status: 404 })
  if (res.status !== 200) return upstreamError(res)
  const result = svTestDeployTargetResultSchema.safeParse(res.body)
  if (!result.success)
    return NextResponse.json({ error: 'Unexpected orchestrator answer' }, { status: 502 })
  return NextResponse.json(result.data)
})
