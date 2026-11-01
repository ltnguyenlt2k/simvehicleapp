import { type NextRequest, NextResponse } from 'next/server'
import { svRobotBuildContract, svRobotBuildResponseSchema } from '@/lib/api/contracts/sv-robotics'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeRobotWorkflow, requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

/** Compiles the workflow into an immutable app identified by its artifact hash (ADR-0067). */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const unauthenticated = await requireSession()
  if (unauthenticated) return unauthenticated
  const parsed = await parseRequest(svRobotBuildContract, request, {})
  if (!parsed.success) return parsed.response
  const { workflowId, workflow, mode } = parsed.data.body
  const denied = await authorizeRobotWorkflow(workflowId, 'write')
  if (denied) return denied
  const result = await roboticsJson('/builds', {
    method: 'POST',
    body: { workflow, mode, source: { workflowId, name: workflow.source.name } },
    timeoutMs: 15000,
  })
  if (result instanceof NextResponse) return result
  return NextResponse.json(svRobotBuildResponseSchema.parse(result.body))
})
