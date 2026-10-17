import { createLogger } from '@sim/logger'
import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { type NextRequest, NextResponse } from 'next/server'
import { svGetScenarioContract, svUpdateScenarioContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listTestCases, saveFirstCase } from '@/lib/sv/server/test-cases'

const logger = createLogger('SvWorkflowScenarioAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Session + workspace permission on the workflow; returns an error response or null. */
async function authorize(
  workflowId: string,
  action: 'read' | 'write'
): Promise<NextResponse | null> {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId: session.user.id,
    action,
  })
  if (!authorization.workflow) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
  }
  if (!authorization.allowed) {
    return NextResponse.json(
      { error: authorization.message || 'Access denied' },
      { status: authorization.status || 403 }
    )
  }
  return null
}

/** Simulation scenario of the workflow (M05-T09): its first test case (ADR-0058); `null` until one is saved. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const workflowId = (await context.params).id
  const denied = await authorize(workflowId, 'read')
  if (denied) return denied

  const parsed = await parseRequest(svGetScenarioContract, request, context)
  if (!parsed.success) return parsed.response

  const [first] = await listTestCases(parsed.data.params.id)
  return NextResponse.json({ scenario: first?.scenario ?? null })
})

/** Saves the simulation scenario of the workflow: its first test case, created as "Default" (ADR-0058). */
export const PUT = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const workflowId = (await context.params).id
  const denied = await authorize(workflowId, 'write')
  if (denied) return denied

  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    throw error
  }

  const parsed = await parseRequest(svUpdateScenarioContract, request, context)
  if (!parsed.success) return parsed.response
  const { scenario } = parsed.data.body

  await saveFirstCase(parsed.data.params.id, scenario)
  logger.info('Scenario saved', { workflowId, inputs: scenario.inputs.length })
  return NextResponse.json({ scenario })
})
