import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svExportProjectContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { authorizeProject } from '@/lib/sv/projects'

const logger = createLogger('SvExportAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Export (M09-T06, ADR-0031): the project zip from the orchestrator — the Velocitas project, the
 * workflows it was generated from and the notices — streamed as a download.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svExportProjectContract, request, context)
  if (!parsed.success) return parsed.response
  let upstream: Response
  try {
    upstream = await callSvService('orchestrator', `/projects/${auth.row.id}/export`, {
      method: 'POST',
      timeoutMs: 120_000,
      signal: request.signal,
    })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'Orchestrator is not configured' }, { status: 503 })
    }
    logger.warn('export unreachable', { project: auth.row.slug })
    return NextResponse.json({ error: 'Orchestrator is unavailable' }, { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null
    const status = [403, 409].includes(upstream.status) ? upstream.status : 502
    return NextResponse.json({ error: body?.message ?? 'Export failed' }, { status })
  }
  logger.info('project exported', { project: auth.row.slug })
  return new Response(upstream.body, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${auth.row.slug}.zip"`,
      'cache-control': 'no-store',
    },
  })
})
