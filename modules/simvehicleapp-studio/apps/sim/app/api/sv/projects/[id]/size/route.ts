import { type NextRequest, NextResponse } from 'next/server'
import { svProjectSizeContract, svProjectSizeSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Disk usage of the vehicle app and what clean would free (ADR-0053). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svProjectSizeContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/size`, { timeoutMs: 30000 })
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const size = svProjectSizeSchema.safeParse(res.body)
  if (!size.success)
    return NextResponse.json({ error: 'Orchestrator returned an invalid answer' }, { status: 502 })
  return NextResponse.json(size.data)
})
