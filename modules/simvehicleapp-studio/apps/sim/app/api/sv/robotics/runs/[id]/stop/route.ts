import { type NextRequest, NextResponse } from 'next/server'
import { svRobotRunSchema, svRobotStopContract } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Stop through the safety lane; the run shows "stopped" only with the robot's confirmation (ADR-0069 §3). */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await requireSession()
  if (denied) return denied
  const parsed = await parseRequest(svRobotStopContract, request, context)
  if (!parsed.success) return parsed.response
  const result = await roboticsJson(`/runs/${parsed.data.params.id}/stop`, {
    method: 'POST',
    timeoutMs: 8000,
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotRunSchema.parse(result.body))
})
