import { type NextRequest, NextResponse } from 'next/server'
import { svRobotDeployContract, svRobotDeploymentSchema } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeRobotWorkflow, requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

/** Binds a build to the observed robot of the mode; deploy never starts or arms (ADR-0069 §2). */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated
  const parsed = await parseRequest(svRobotDeployContract, request, {})
  if (!parsed.success) return parsed.response
  const { workflowId, buildId, mode } = parsed.data.body
  const denied = await authorizeRobotWorkflow(workflowId, 'write')
  if (denied) return denied
  const result = await roboticsJson('/deployments', { method: 'POST', body: { buildId, mode } })
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotDeploymentSchema.parse(result.body))
})
