import {
  assertWorkflowMutable,
  authorizeWorkflowByWorkspacePermission,
  WorkflowLockedError,
} from '@sim/platform-authz/workflow'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

/**
 * Session + workspace permission on a workflow for the vehicle data routes (scenario, test cases); a write also
 * needs the workflow unlocked. Returns the error response, or null when allowed.
 */
export async function authorizeSvWorkflow(
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
  if (action === 'write') {
    try {
      await assertWorkflowMutable(workflowId)
    } catch (error) {
      if (error instanceof WorkflowLockedError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      throw error
    }
  }
  return null
}
