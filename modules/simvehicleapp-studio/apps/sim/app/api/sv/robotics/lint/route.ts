import { type NextRequest, NextResponse } from 'next/server'
import { svRobotLintContract, svRobotLintResponseSchema } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

/** RobotFlow checks of the canvas (ADR-0068 §5): diagnostics only, nothing is stored. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const denied = await requireSession()
  if (denied) return denied
  const parsed = await parseRequest(svRobotLintContract, request, {})
  if (!parsed.success) return parsed.response
  const { workflow, mode } = parsed.data.body
  const result = await roboticsJson('/lint', {
    method: 'POST',
    body: { workflow, mode },
    timeoutMs: 5000,
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotLintResponseSchema.parse(result.body))
})
