import { type NextRequest, NextResponse } from 'next/server'
import { svCleanProjectContract, svFreedSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Removes the vehicle app's build outputs, keeps its sources; the next SynCode rebuilds (ADR-0053). */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svCleanProjectContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/clean`, {
    method: 'POST',
    timeoutMs: 60000,
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const freed = svFreedSchema.safeParse(res.body)
  if (!freed.success)
    return NextResponse.json({ error: 'Orchestrator returned an invalid answer' }, { status: 502 })
  return NextResponse.json(freed.data)
})
