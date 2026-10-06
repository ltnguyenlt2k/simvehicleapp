import { type NextRequest, NextResponse } from 'next/server'
import { svGetRunContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, runOf } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; rid: string }> }

/** One run of the project (state machine of analysis/08 §5). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svGetRunContract, request, context)
  if (!parsed.success) return parsed.response
  const run = await runOf(auth.row.id, parsed.data.params.rid)
  return run instanceof NextResponse ? run : NextResponse.json(run)
})
