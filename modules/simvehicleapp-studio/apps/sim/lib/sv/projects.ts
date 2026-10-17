import { db } from '@sim/db'
import { svProjects, svWorkflowSettings, workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import type { Variable } from '@sim/workflow-types/workflow'
import { and, count, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import {
  type SvDiagnostic,
  svDiagnosticSchema,
  svGenerationSchema,
  svProjectSchema,
  svRunSchema,
} from '@/lib/api/contracts/sv'
import { getSession } from '@/lib/auth'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { adaptWorkflow, issueToDiagnostic } from '@/lib/sv/graph-adapter'
import { scenariosForSynCode, testCasesOf } from '@/lib/sv/server/test-cases'
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
 * An orchestrator error relayed to the browser: 400/404/409/422/429/507 keep their status (a diagnostics body is
 * relayed as `{ error, diagnostics }`), anything else is a 502.
 */
export function upstreamError(res: { status: number; body: unknown }): NextResponse {
  const body = res.body as { message?: unknown; error?: unknown } | null
  const message =
    typeof body?.message === 'string' && body.message
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : `Orchestrator error ${res.status}`
  // Diagnostics arrays: 422 (rejected), 409 quota, 429 queue full, 507 disk low (ADR-0053) keep their status and
  // their message — before this, a 409/429/507 array became a bare 502 "Orchestrator error".
  if ([409, 422, 429, 507].includes(res.status) && Array.isArray(res.body)) {
    const diagnostics = res.body.flatMap((d) => {
      const v = svDiagnosticSchema.safeParse(d)
      return v.success ? [v.data] : []
    })
    return NextResponse.json(
      { error: diagnostics[0]?.message ?? 'Invalid request', diagnostics },
      { status: res.status }
    )
  }
  if ([400, 404, 409, 422, 429, 507].includes(res.status) && !Array.isArray(res.body)) {
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

const SANDBOX = /^toolchain-(cpp|python|rust):[0-9]{2,5}$/

/**
 * The databroker of the project's active run when it has one of its own (ADR-0057): Signals, inject and Play
 * of the app then reach that run only. Undefined on the shared stack, without a run, or when the orchestrator
 * is unreachable (the shared databroker of the release answers).
 */
export async function activeSandbox(projectId: string): Promise<string | undefined> {
  const res = await orchestrator(`/runs?projectId=${encodeURIComponent(projectId)}&active=true`)
  if (res instanceof NextResponse || res.status !== 200) return undefined
  const runs = (res.body as { runs?: { sandbox?: unknown }[] } | null)?.runs ?? []
  const sandbox = runs.find((r) => typeof r.sandbox === 'string')?.sandbox
  return typeof sandbox === 'string' && SANDBOX.test(sandbox) ? sandbox : undefined
}

/** Workflows of `workspaceId` among `ids` (others are dropped: a project never reaches another workspace). */
export async function workflowsInWorkspace(workspaceId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.workspaceId, workspaceId),
        inArray(workflow.id, ids),
        isNull(workflow.archivedAt)
      )
    )
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

/** Test cases of the workflows: they become the generated tests (ADR-0022 §8; one test per case, ADR-0058 §2). */
export async function scenariosFor(workflowIds: string[]) {
  if (workflowIds.length === 0) return []
  return scenariosForSynCode(await testCasesOf(workflowIds))
}

/** Vehicle apps a workspace may have (`SV_MAX_APPS_PER_WORKSPACE`, default 10; ADR-0053 §B.3). */
export function workspaceAppLimit(): number {
  const v = Number(process.env.SV_MAX_APPS_PER_WORKSPACE)
  return Number.isInteger(v) && v >= 1 ? v : 10
}

/** Number of vehicle apps linked to the workspace. */
export async function workspaceAppCount(workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(svProjects)
    .where(eq(svProjects.workspaceId, workspaceId))
  return Number(row?.n ?? 0)
}

const RECONCILE_EVERY_MS = 60 * 60 * 1000
let lastReconcile = 0

/**
 * Removes what nothing can reach any more (ADR-0053 §B.7): apps of archived workspaces (Sim archives a deleted
 * workspace, so the `sv_projects` cascade never fires) are deleted in the orchestrator, and links to apps the
 * orchestrator no longer has are dropped. Apps the studio never linked (gates, scripts) are never touched here.
 * Runs at most once an hour per server process unless `force`.
 */
export async function reconcileApps(
  force = false
): Promise<{ deletedApps: number; droppedLinks: number }> {
  const result = { deletedApps: 0, droppedLinks: 0 }
  if (!force && Date.now() - lastReconcile < RECONCILE_EVERY_MS) return result
  lastReconcile = Date.now()
  const listed = await orchestrator('/projects')
  if (listed instanceof NextResponse || listed.status !== 200) return result
  const known = new Set(
    ((listed.body as { projects?: { id?: unknown }[] } | null)?.projects ?? []).map((p) =>
      String(p.id)
    )
  )
  const archived = await db
    .select({ id: svProjects.id })
    .from(svProjects)
    .innerJoin(workspace, eq(workspace.id, svProjects.workspaceId))
    .where(isNotNull(workspace.archivedAt))
  for (const { id } of archived) {
    if (known.has(id)) {
      const del = await orchestrator(`/projects/${id}`, { method: 'DELETE', timeoutMs: 30000 })
      if (del instanceof NextResponse || (del.status !== 204 && del.status !== 404)) continue
      result.deletedApps++
    }
    await db.delete(svProjects).where(eq(svProjects.id, id))
  }
  const links = await db.select({ id: svProjects.id }).from(svProjects)
  const stale = links.map((l) => l.id).filter((id) => !known.has(id))
  if (stale.length) {
    await db.delete(svProjects).where(inArray(svProjects.id, stale))
    result.droppedLinks = stale.length
  }
  if (result.deletedApps || result.droppedLinks) logger.info('apps reconciled', result)
  return result
}
