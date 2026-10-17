import { db } from '@sim/db'
import { svWorkflowTestCases } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { type SvScenario, type SvTestCase, svScenarioSchema } from '@/lib/api/contracts/sv'
import type { DbOrTx } from '@/lib/db/types'

/** The name of the case a workflow's single scenario became (migration 0253) and the first case created for it. */
export const DEFAULT_CASE_NAME = 'Default'

type Row = typeof svWorkflowTestCases.$inferSelect

/** A stored case that no longer validates is left out rather than breaking the editor or SynCode. */
function toCase(row: Row): SvTestCase | null {
  const scenario = svScenarioSchema.safeParse(row.scenario)
  return scenario.success
    ? { id: row.id, name: row.name, scenario: scenario.data, position: row.position }
    : null
}

/** Test cases of a workflow in order (position, then id: deterministic). */
export async function listTestCases(workflowId: string, tx: DbOrTx = db): Promise<SvTestCase[]> {
  const rows = await tx
    .select()
    .from(svWorkflowTestCases)
    .where(eq(svWorkflowTestCases.workflowId, workflowId))
    .orderBy(asc(svWorkflowTestCases.position), asc(svWorkflowTestCases.id))
  return rows.flatMap((r) => toCase(r) ?? [])
}

/** Test cases of several workflows (SynCode), in each workflow's order. */
export async function testCasesOf(workflowIds: string[]): Promise<Map<string, SvTestCase[]>> {
  const out = new Map<string, SvTestCase[]>()
  if (!workflowIds.length) return out
  const rows = await db
    .select()
    .from(svWorkflowTestCases)
    .where(inArray(svWorkflowTestCases.workflowId, workflowIds))
    .orderBy(asc(svWorkflowTestCases.position), asc(svWorkflowTestCases.id))
  for (const r of rows) {
    const c = toCase(r)
    if (c) out.set(r.workflowId, [...(out.get(r.workflowId) ?? []), c])
  }
  return out
}

export async function createTestCase(
  workflowId: string,
  name: string,
  scenario: SvScenario,
  tx: DbOrTx = db
): Promise<SvTestCase> {
  const existing = await listTestCases(workflowId, tx)
  const position = existing.length ? Math.max(...existing.map((c) => c.position)) + 1 : 0
  const id = `tc_${generateId()}`
  await tx
    .insert(svWorkflowTestCases)
    .values({ id, workflowId, name, scenario, position, updatedAt: new Date() })
  return { id, name, scenario, position }
}

export async function updateTestCase(
  workflowId: string,
  caseId: string,
  patch: { name?: string; scenario?: SvScenario; position?: number }
): Promise<SvTestCase | null> {
  const rows = await db
    .update(svWorkflowTestCases)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(svWorkflowTestCases.id, caseId), eq(svWorkflowTestCases.workflowId, workflowId)))
    .returning()
  return rows[0] ? toCase(rows[0]) : null
}

export async function deleteTestCase(workflowId: string, caseId: string): Promise<boolean> {
  const rows = await db
    .delete(svWorkflowTestCases)
    .where(and(eq(svWorkflowTestCases.id, caseId), eq(svWorkflowTestCases.workflowId, workflowId)))
    .returning({ id: svWorkflowTestCases.id })
  return rows.length > 0
}

/**
 * The scenario editor and Record before the Test tab (M05/M08): they read and save the workflow's first case —
 * created as "Default" on the first save.
 */
export async function saveFirstCase(workflowId: string, scenario: SvScenario): Promise<void> {
  const [first] = await listTestCases(workflowId)
  if (first) await updateTestCase(workflowId, first.id, { scenario })
  else await createTestCase(workflowId, DEFAULT_CASE_NAME, scenario)
}

/** Copies every case of a workflow to its duplicate (M17-T03), in the duplication's transaction. */
export async function copyTestCases(tx: DbOrTx, fromId: string, toId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(svWorkflowTestCases)
    .where(eq(svWorkflowTestCases.workflowId, fromId))
    .orderBy(asc(svWorkflowTestCases.position), asc(svWorkflowTestCases.id))
  if (!rows.length) return
  await tx.insert(svWorkflowTestCases).values(
    rows.map((r) => ({
      id: `tc_${generateId()}`,
      workflowId: toId,
      name: r.name,
      scenario: r.scenario,
      position: r.position,
      updatedAt: new Date(),
    }))
  )
}

/**
 * Test cases ⇒ `scenarios[]` of SynCode (ADR-0058 §2): a workflow with one case sends it without a name, so its
 * generated test stays the same as before test cases; with several, one test per case named after it.
 */
export function scenariosForSynCode(
  cases: Map<string, SvTestCase[]>
): { workflowId: string; scenario: SvScenario; caseName?: string }[] {
  return [...cases].flatMap(([workflowId, list]) =>
    list.length === 1
      ? [{ workflowId, scenario: list[0].scenario }]
      : list.map((c) => ({ workflowId, scenario: c.scenario, caseName: c.name }))
  )
}
