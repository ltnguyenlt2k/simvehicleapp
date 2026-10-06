import { type NextRequest, NextResponse } from 'next/server'
import { svGetGenerationContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, parseGeneration, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; gid: string }> }

/** A generation: stages, verification (Appendix A) or the failing stage + diagnostics (Appendix B). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svGetGenerationContract, request, context)
  if (!parsed.success) return parsed.response
  const gid = encodeURIComponent(parsed.data.params.gid)
  const res = await orchestrator(`/projects/${auth.row.id}/generations/${gid}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const generation = parseGeneration(res.body)
  if (!generation.success) {
    return NextResponse.json(
      { error: 'Orchestrator returned an invalid generation' },
      { status: 502 }
    )
  }
  return NextResponse.json(generation.data)
})
