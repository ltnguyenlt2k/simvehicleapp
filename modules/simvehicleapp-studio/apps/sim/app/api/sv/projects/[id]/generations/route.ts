import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svStartGenerationContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  authorizeProject,
  graphsFor,
  orchestrator,
  parseGeneration,
  parseProject,
  scenariosFor,
  upstreamError,
} from '@/lib/sv/projects'

const logger = createLogger('SvGenerationsAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * SynCode (M07-T18): the graphs of every enabled workflow of the project (saved state, or the
 * editor's graph for the open one) and their saved scenarios go to the orchestrator, which queues
 * the generation; progress follows on `…/events`.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svStartGenerationContract, request, context)
  if (!parsed.success) return parsed.response
  const { overwriteModified, open } = parsed.data.body

  const current = await orchestrator(`/projects/${auth.row.id}`)
  if (current instanceof NextResponse) return current
  if (current.status !== 200) return upstreamError(current)
  const project = parseProject(current.body)
  if (!project.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid project' }, { status: 502 })
  }
  const enabled = project.data.workflows.filter((w) => w.enabled).map((w) => w.simWorkflowId)
  if (enabled.length === 0) {
    return NextResponse.json(
      { error: 'Assign at least one workflow to the project' },
      { status: 400 }
    )
  }
  if (open && !enabled.includes(open.workflowId)) {
    return NextResponse.json(
      { error: 'The open workflow is not part of this project' },
      { status: 400 }
    )
  }
  const { graphs, missing, issues } = await graphsFor(
    auth.row.workspaceId,
    enabled,
    project.data.vssRelease,
    open
  )
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Workflows no longer exist: ${missing.join(', ')}` },
      { status: 409 }
    )
  }
  if (issues.length > 0) {
    return NextResponse.json({ error: issues[0].message, diagnostics: issues }, { status: 422 })
  }
  const scenarios = await scenariosFor(enabled)
  const res = await orchestrator(`/projects/${auth.row.id}/generations`, {
    method: 'POST',
    body: {
      graphs,
      ...(scenarios.length ? { scenarios } : {}),
      ...(overwriteModified ? { overwriteModified } : {}),
    },
    timeoutMs: 30000,
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 202) return upstreamError(res)
  const generation = parseGeneration(res.body)
  if (!generation.success) {
    return NextResponse.json(
      { error: 'Orchestrator returned an invalid generation' },
      { status: 502 }
    )
  }
  logger.info('SynCode queued', { project: auth.row.slug, generation: generation.data.id })
  return NextResponse.json(generation.data, { status: 202 })
})
