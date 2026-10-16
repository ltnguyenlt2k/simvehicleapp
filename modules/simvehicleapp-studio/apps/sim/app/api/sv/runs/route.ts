import { db } from '@sim/db'
import { svProjects } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type SvMyRun,
  svMyRunsContract,
  svRunLimitsSchema,
  svRunSchema,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { orchestrator, projectOf, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

/** Limits of a stack that predates them: one run at a time, no expiry. */
const SHARED_STACK = { sandbox: false, perUser: 1, total: 1, maxMinutes: 0, maxExtensions: 0 }

/**
 * My runs (ADR-0057, M17-T05): the apps the signed-in user runs now, with their app name and
 * workspace, and the run limits (whether apps run side by side, the time limit, Extend).
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svMyRunsContract, request, {})
  if (!parsed.success) return parsed.response
  const query = new URLSearchParams({ active: 'true', ownerUserId: session.user.id })
  const res = await orchestrator(`/runs?${query}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const body = res.body as { runs?: unknown[]; limits?: unknown } | null
  const limits = svRunLimitsSchema.safeParse(body?.limits)
  const runs = (body?.runs ?? []).flatMap((r) => {
    const v = svRunSchema.safeParse(r)
    return v.success ? [v.data] : []
  })
  const ids = [...new Set(runs.map((r) => r.projectId))]
  const rows = ids.length
    ? await db
        .select({ id: svProjects.id, workspaceId: svProjects.workspaceId })
        .from(svProjects)
        .where(inArray(svProjects.id, ids))
    : []
  const workspaceOf = new Map(rows.map((r) => [r.id, r.workspaceId]))
  const names = new Map<string, string>()
  for (const id of ids) {
    const project = workspaceOf.has(id) ? await projectOf(id) : null
    if (project && !(project instanceof NextResponse)) names.set(id, project.name)
  }
  const mine: SvMyRun[] = runs.flatMap((r) => {
    const workspaceId = workspaceOf.get(r.projectId)
    return workspaceId
      ? [{ ...r, workspaceId, projectName: names.get(r.projectId) ?? r.projectId }]
      : []
  })
  return NextResponse.json({ runs: mine, limits: limits.success ? limits.data : SHARED_STACK })
})
