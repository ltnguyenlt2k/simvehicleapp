import { db } from '@sim/db'
import { svProjects, svWorkflowScenarios, svWorkflowSettings, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { Variable } from '@sim/workflow-types/workflow'
import { and, eq, inArray } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  type SvDiagnostic,
  svDiagnosticSchema,
  svGenerationSchema,
  svProjectSchema,
  svRunSchema,
  svScenarioSchema,
} from '@/lib/api/contracts/sv'
import { getSession } from '@/lib/auth'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { adaptWorkflow, issueToDiagnostic } from '@/lib/sv/graph-adapter'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SvProjects')

/**
 * Server side of the vehicle-app projects (M07-T17/T18): every project call is scoped to a workspace
 * the user can access (`sv_projects`), the orchestrator owns the project itself, and SynCode sends it
 * the WorkflowGraph of every enabled workflow built from the saved workflows (the open one may come
 * fresher from the editor).
 */

export type SvProjectRow = typeof svProjects.$inferSelect

/** Session + access to the project's workspace; returns the row or an error response. */
export async function authorizeProject(
  projectId: string,
  action: 'read' | 'write'
): Promise<{ row: SvProjectRow; userId: string } | NextResponse> {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [row] = await db.select().from(svProjects).where(eq(svProjects.id, projectId)).limit(1)
  if (!row) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  const access = await checkWorkspaceAccess(row.workspaceId, session.user.id)
  if (!access.hasAccess) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (action === 'write' && !access.canWrite) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return { row, userId: session.user.id }
}

const SERVICE_NAME: Record<'orchestrator' | 'signal-gateway', string> = {
  orchestrator: 'Orchestrator',
  'signal-gateway': 'Signal gateway',
}

/** JSON call to an internal service; outages become 502/503 without upstream details. */
export async function svJson(
  service: 'orchestrator' | 'signal-gateway',
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<{ status: number; body: unknown } | NextResponse> {
  let res: Response
  try {
    res = await callSvService(service, path, { timeoutMs: 15000, ...init })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json(
        { error: `${SERVICE_NAME[service]} is not configured` },
        { status: 503 }
      )
    }
    logger.warn('service unreachable', { service, path })
    return NextResponse.json({ error: `${SERVICE_NAME[service]} is unavailable` }, { status: 502 })
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body }
}

/** JSON call to the orchestrator. */
export function orchestrator(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
) {
  return svJson('orchestrator', path, init)
}

/**
 * An orchestrator error relayed to the browser: 404/409/422 keep their status (422 carries the
 * diagnostics), anything else is a 502.
 */
export function upstreamError(res: { status: number; body: unknown }): NextResponse {
  const body = res.body as { message?: unknown; error?: unknown } | null
  const message =
    typeof body?.message === 'string' && body.message
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : `Orchestrator error ${res.status}`
  if (res.status === 422 && Array.isArray(res.body)) {
    const diagnostics = res.body.flatMap((d) => {
      const v = svDiagnosticSchema.safeParse(d)
      return v.success ? [v.data] : []
    })
    return NextResponse.json(
      { error: diagnostics[0]?.message ?? 'Invalid request', diagnostics },
      { status: 422 }
    )
  }
  if ([400, 404, 409, 422].includes(res.status) && !Array.isArray(res.body)) {
    return NextResponse.json({ error: message }, { status: res.status })
  }
  logger.warn('orchestrator error', { status: res.status })
  return NextResponse.json({ error: 'Orchestrator error' }, { status: 502 })
}

/** A generation of the orchestrator, checked against the BFF contract. */
export function parseGeneration(body: unknown) {
  return svGenerationSchema.safeParse(body)
}

/** A project of the orchestrator, checked against the BFF contract. */
export function parseProject(body: unknown) {
  return svProjectSchema.safeParse(body)
}

/** The orchestrator's view of an authorized project (its VSS release selects the databroker). */
export async function projectOf(projectId: string) {
  const res = await orchestrator(`/projects/${projectId}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const project = parseProject(res.body)
  if (!project.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  return project.data
}

/** A run of the project (another project's run is "not found": runs share one stack). */
export async function runOf(projectId: string, runId: string) {
  const res = await orchestrator(`/runs/${encodeURIComponent(runId)}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const run = svRunSchema.safeParse(res.body)
  if (!run.success)
    return NextResponse.json({ error: 'Orchestrator returned an invalid run' }, { status: 502 })
  if (run.data.projectId !== projectId)
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  return run.data
}

/** Workflows of `workspaceId` among `ids` (others are dropped: a project never reaches another workspace). */
export async function workflowsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), inArray(workflow.id, ids)))
  const found = new Set(rows.map((r) => r.id))
  return ids.filter((id) => found.has(id))
}

/**
 * WorkflowGraph v1 of each workflow, as the editor's adapter builds it, from the saved state; the
 * release is the workflow's pinned one, else the project's. Parts the adapter had to drop (invalid
 * container, variable name) come back as `issues`: SynCode must not generate a partial app.
 */
export async function graphsFor(
  workspaceId: string,
  workflowIds: string[],
  projectRelease: string,
  open?: { workflowId: string; graph: Record<string, unknown> }
): Promise<{ graphs: Record<string, unknown>[]; missing: string[]; issues: SvDiagnostic[] }> {
  const ids = await workflowsInWorkspace(workspaceId, workflowIds)
  const missing = workflowIds.filter((id) => !ids.includes(id))
  const rows = ids.length
    ? await db
        .select({ id: workflow.id, name: workflow.name, variables: workflow.variables })
        .from(workflow)
        .where(inArray(workflow.id, ids))
    : []
  const pinned = ids.length
    ? await db.select().from(svWorkflowSettings).where(inArray(svWorkflowSettings.workflowId, ids))
    : []
  const graphs: Record<string, unknown>[] = []
  const issues: SvDiagnostic[] = []
  for (const id of ids) {
    if (open && open.workflowId === id) {
      graphs.push(open.graph)
      continue
    }
    const row = rows.find((r) => r.id === id)
    const state = await loadWorkflowFromNormalizedTables(id)
    if (!row || !state) {
      missing.push(id)
      continue
    }
    const variables = Object.values((row.variables as Record<string, Variable>) ?? {})
    const adapted = adaptWorkflow({
      workflowId: id,
      name: row.name,
      vssRelease: pinned.find((p) => p.workflowId === id)?.vssRelease ?? projectRelease,
      state: {
        blocks: state.blocks,
        edges: state.edges,
        loops: state.loops,
        parallels: state.parallels,
      },
      variables,
    })
    issues.push(...adapted.issues.map((i) => issueToDiagnostic(i, id)))
    // double-cast-allowed: WorkflowGraphOut is the WorkflowGraph v1 JSON object sent as-is
    graphs.push(adapted.graph as unknown as Record<string, unknown>)
  }
  return { graphs, missing, issues }
}

/** Saved simulation scenarios of the workflows (they become the generated tests, ADR-0022 §8). */
export async function scenariosFor(workflowIds: string[]) {
  if (workflowIds.length === 0) return []
  const rows = await db
    .select()
    .from(svWorkflowScenarios)
    .where(inArray(svWorkflowScenarios.workflowId, workflowIds))
  return rows.flatMap((r) => {
    const parsed = svScenarioSchema.safeParse(r.scenario)
    return parsed.success ? [{ workflowId: r.workflowId, scenario: parsed.data }] : []
  })
}
