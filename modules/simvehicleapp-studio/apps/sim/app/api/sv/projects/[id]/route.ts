import { type NextRequest, NextResponse } from 'next/server'
import { svGetProjectContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, parseProject, upstreamError } from '@/lib/sv/projects'

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
