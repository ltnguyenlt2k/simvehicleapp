import { type NextRequest, NextResponse } from 'next/server'
import { svRobotRunContract, svRobotRunSchema } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Status, block trace and logs of a robot run after sequence number `after`. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await requireSession()
  if (denied) return denied
  const parsed = await parseRequest(svRobotRunContract, request, context)
  if (!parsed.success) return parsed.response
  const result = await roboticsJson(
    `/runs/${parsed.data.params.id}?after=${parsed.data.query.after}`
  )
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotRunSchema.parse(result.body))
})
