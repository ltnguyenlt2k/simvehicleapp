import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { svLintContract, svLintResponseSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvLintAPI')

export const dynamic = 'force-dynamic'

/**
 * Realtime lint of the open workflow (M03-T11): forwards the WorkflowGraph built in the browser to the
 * compiler's `POST /lint` and returns its diagnostics. Compiler/catalog outages are 503/502 without
 * upstream details; the editor keeps the last result.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(svLintContract, request, {})
  if (!parsed.success) return parsed.response

  let upstream: Response
  try {
    upstream = await callSvService('compiler', '/lint', {
      method: 'POST',
      retryOnReset: true,
      body: { graph: parsed.data.body.graph },
      timeoutMs: 5000,
    })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'Compiler is not configured' }, { status: 503 })
    }
    logger.warn('compiler unreachable', { error: getErrorMessage(error, 'unreachable') })
    return NextResponse.json({ error: 'Compiler is unavailable' }, { status: 502 })
  }
  if (upstream.status === 503) {
    return NextResponse.json({ error: 'VSS catalog is unavailable' }, { status: 503 })
  }
  const payload = svLintResponseSchema.safeParse(await upstream.json().catch(() => null))
  if (!upstream.ok || !payload.success) {
    logger.warn('compiler lint failed', { status: upstream.status })
    return NextResponse.json({ error: 'Compiler is unavailable' }, { status: 502 })
  }
  return NextResponse.json(payload.data)
})
