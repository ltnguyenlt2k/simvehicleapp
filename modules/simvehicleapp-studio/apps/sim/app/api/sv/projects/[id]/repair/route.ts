import { type NextRequest, NextResponse } from 'next/server'
import { svRepairProjectContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, parseProject, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Re-creates a failed vehicle app from scratch, keeping its workflows (ADR-0053); it is `creating` again. */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svRepairProjectContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/repair`, {
    method: 'POST',
    timeoutMs: 30000,
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 202) return upstreamError(res)
  const project = parseProject(res.body)
  if (!project.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  return NextResponse.json(project.data)
})
