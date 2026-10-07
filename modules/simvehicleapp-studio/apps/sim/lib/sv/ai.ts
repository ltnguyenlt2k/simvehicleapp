import { db } from '@sim/db'
import { svProjects } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { graphsFor, projectOf, scenariosFor } from '@/lib/sv/projects'

const logger = createLogger('SvAi')

/** Header the ai-assistant reads the user from (contracts `ai-assistant.v1`, ADR-0032 §5). */
export const AI_USER_HEADER = 'x-sv-user-id'

/** What a turn may act on (contracts `ai-assistant.v1` `ChatContext`). */
export interface AiTurnContext {
  workflow: {
    workflowId: string
    name?: string
    vssRelease: string
    graph: Record<string, unknown>
  }
  project?: {
    id: string
    vssRelease: string
    graphs: Record<string, unknown>[]
    scenarios: { workflowId: string; scenario: unknown }[]
  }
}

/** Signed-in user; the ai-assistant scopes conversations and rate limits to this id. */
export async function aiUser(): Promise<{ userId: string } | NextResponse> {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return { userId: session.user.id }
}

/**
 * Context of a turn from the editor: the open workflow (the user must be allowed to edit it — a
 * proposal changes it) with the graph on the canvas, and the project it is used in when given (same
 * workspace, the workflow enabled in it). Project tools then see every enabled workflow of the
 * project, the open one as on the canvas.
 */
export async function aiTurnContext(
  userId: string,
  input: { workflowId: string; graph: Record<string, unknown>; projectId?: string }
): Promise<AiTurnContext | NextResponse> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: input.workflowId,
    userId,
    action: 'write',
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
  const workspaceId = authorization.workflow.workspaceId
  const graph = input.graph as { workflowId?: unknown; name?: unknown; vss?: { release?: unknown } }
  const vssRelease = typeof graph.vss?.release === 'string' ? graph.vss.release : null
  if (graph.workflowId !== input.workflowId || !vssRelease) {
    return NextResponse.json(
      { error: 'graph must be the WorkflowGraph of the open workflow (workflowId, vss.release)' },
      { status: 400 }
    )
  }
  const context: AiTurnContext = {
    workflow: {
      workflowId: input.workflowId,
      ...(typeof graph.name === 'string' ? { name: graph.name } : {}),
      vssRelease,
      graph: input.graph,
    },
  }
  if (!input.projectId || !workspaceId) return context

  const [row] = await db
    .select()
    .from(svProjects)
    .where(eq(svProjects.id, input.projectId))
    .limit(1)
  if (!row || row.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  const project = await projectOf(row.id)
  if (project instanceof NextResponse) return project
  const enabled = project.workflows.filter((w) => w.enabled).map((w) => w.simWorkflowId)
  if (!enabled.includes(input.workflowId)) {
    // The panel only sends the project the workflow is used in; anything else is a stale choice.
    logger.info('turn without project: workflow not enabled in it', { project: row.slug })
    return context
  }
  const { graphs } = await graphsFor(workspaceId, enabled, project.vssRelease, {
    workflowId: input.workflowId,
    graph: input.graph,
  })
  context.project = {
    id: row.id,
    vssRelease: project.vssRelease,
    graphs,
    scenarios: await scenariosFor(enabled),
  }
  return context
}
