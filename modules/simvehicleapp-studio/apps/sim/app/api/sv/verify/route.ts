import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { svLintResponseSchema, svVerifyContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvVerifyAPI')

export const dynamic = 'force-dynamic'

/**
 * Verify of the open workflow (M04-T11): forwards the WorkflowGraph built in the browser to the
 * compiler's `POST /compile` (mode `verify`: every check including types and units, no IR) and
 * returns its diagnostics. Compiler/catalog outages are 503/502 without upstream details.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(svVerifyContract, request, {})
  if (!parsed.success) return parsed.response

  let upstream: Response
  try {
    upstream = await callSvService('compiler', '/compile', {
      method: 'POST',
      retryOnReset: true,
      body: { graph: parsed.data.body.graph, mode: 'verify' },
      timeoutMs: 10000,
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
    logger.warn('compiler verify failed', { status: upstream.status })
    return NextResponse.json({ error: 'Compiler is unavailable' }, { status: 502 })
  }
  return NextResponse.json(payload.data)
})
