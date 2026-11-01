import { type NextRequest, NextResponse } from 'next/server'
import { svRobotRunSchema, svRobotStartContract } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeRobotWorkflow, requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

/** Explicit Start of a deployment, after the user confirmed it in the editor (ADR-0069 §2). */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated
  const parsed = await parseRequest(svRobotStartContract, request, {})
  if (!parsed.success) return parsed.response
  const { workflowId, deploymentId } = parsed.data.body
  const denied = await authorizeRobotWorkflow(workflowId, 'write')
  if (denied) return denied
  const result = await roboticsJson('/runs', { method: 'POST', body: { deploymentId } })
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotRunSchema.parse(result.body))
})
