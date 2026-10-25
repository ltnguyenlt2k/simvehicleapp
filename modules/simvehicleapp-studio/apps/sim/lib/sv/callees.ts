import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { graphsFor } from '@/lib/sv/projects'

/** Compiler limits of sub-workflows (ADR-0063): calls nest 4 levels deep, 16 function workflows at most. */
const MAX_DEPTH = 4
const MAX_CALLEES = 16

type Graph = Record<string, unknown>

/** Workflow ids the `sv_call_workflow` blocks of `graph` call. */
function calledIds(graph: Graph): string[] {
  const blocks = Array.isArray(graph.blocks) ? (graph.blocks as Graph[]) : []
  return blocks
    .filter((b) => b.type === 'sv_call_workflow')
    .map((b) => (b.props as Graph | undefined)?.workflowId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

/**
 * The function workflows `graphs` call, directly or through each other (ADR-0063): each one the user may read, as the
 * editor's adapter builds it, in the calling graph's VSS release. A workflow the user may not read, or that no longer
 * exists, is left out: the compiler reports SUBWORKFLOW_NOT_FOUND on the call.
 */
export async function calleesFor(userId: string, graphs: Graph[]): Promise<Graph[]> {
  const release = String((graphs[0]?.vss as Graph | undefined)?.release ?? 'v4.0')
  const seen = new Set(graphs.map((g) => String(g.workflowId ?? '')))
  const callees: Graph[] = []
  let level = graphs
  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth++) {
    const next: Graph[] = []
    for (const id of [...new Set(level.flatMap(calledIds))].sort()) {
      if (seen.has(id) || callees.length >= MAX_CALLEES) continue
      seen.add(id)
      const access = await authorizeWorkflowByWorkspacePermission({
        workflowId: id,
        userId,
        action: 'read',
      })
      const workspaceId = access.allowed ? access.workflow?.workspaceId : null
      if (!workspaceId) continue
      const { graphs: loaded } = await graphsFor(workspaceId, [id], release)
      for (const g of loaded) {
        callees.push(g)
        next.push(g)
      }
    }
    level = next
  }
  return callees
}

/** `{ callees }` for a compiler request about `graph`, or nothing when it calls no workflow. */
export async function calleesBody(userId: string, graph: unknown): Promise<{ callees?: Graph[] }> {
  if (!graph || typeof graph !== 'object') return {}
  const callees = await calleesFor(userId, [graph as Graph])
  return callees.length ? { callees } : {}
}
