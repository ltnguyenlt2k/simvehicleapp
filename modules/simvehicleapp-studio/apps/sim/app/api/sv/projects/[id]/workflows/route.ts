import { type NextRequest, NextResponse } from 'next/server'
import { svUpdateProjectWorkflowsContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeProject,
  orchestrator,
  parseProject,
  upstreamError,
  workflowsInWorkspace,
} from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** The workflows SynCode generates into the project; workflows of other workspaces are refused. */
export const PUT = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svUpdateProjectWorkflowsContract, request, context)
  if (!parsed.success) return parsed.response
  const requested = [...new Set(parsed.data.body.workflowIds)]
  const ids = await workflowsInWorkspace(auth.row.workspaceId, requested)
  if (ids.length !== requested.length) {
    return NextResponse.json({ error: 'Workflow not found in this workspace' }, { status: 400 })
  }
  const res = await orchestrator(`/projects/${auth.row.id}/workflows`, {
    method: 'PUT',
    body: { workflows: ids.map((simWorkflowId) => ({ simWorkflowId, enabled: true })) },
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const project = parseProject(res.body)
  if (!project.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  return NextResponse.json(project.data)
})
