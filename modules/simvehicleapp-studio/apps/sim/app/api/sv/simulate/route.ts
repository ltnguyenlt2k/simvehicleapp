import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type SvSimulateResponse,
  svLintResponseSchema,
  svSimulateContract,
  svSimulateResponseSchema,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvSimulateAPI')

export const dynamic = 'force-dynamic'

/**
 * Simulate (M05-T09/T10, ADR-0017): compiles the WorkflowGraph built in the browser with the
 * compiler's `POST /compile` (build) and, when it compiles, runs the IR with the scenario on
 * `POST /simulate`. Compile errors come back as diagnostics without a result.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(svSimulateContract, request, {})
  if (!parsed.success) return parsed.response
  const { graph, scenario } = parsed.data.body

  try {
    const compiled = await callSvService('compiler', '/compile', {
      method: 'POST',
      retryOnReset: true,
      body: { graph, mode: 'build' },
      timeoutMs: 10000,
    })
    if (compiled.status === 503) {
      return NextResponse.json({ error: 'VSS catalog is unavailable' }, { status: 503 })
    }
    const compileBody = (await compiled.json().catch(() => null)) as { ir?: unknown } | null
    const diagnostics = svLintResponseSchema.safeParse(compileBody)
    if (!compiled.ok || !diagnostics.success) {
      logger.warn('compiler build failed', { status: compiled.status })
      return NextResponse.json({ error: 'Compiler is unavailable' }, { status: 502 })
    }
    if (!compileBody?.ir) {
      const body: SvSimulateResponse = { diagnostics: diagnostics.data.diagnostics }
      return NextResponse.json(body)
    }

    const simulated = await callSvService('compiler', '/simulate', {
      method: 'POST',
      retryOnReset: true,
      body: { ir: compileBody.ir, scenario },
      timeoutMs: 15000,
    })
    const sim = (await simulated.json().catch(() => null)) as Record<string, unknown> | null
    const result = svSimulateResponseSchema.shape.result.safeParse(sim ?? undefined)
    const simDiagnostics = svLintResponseSchema.safeParse(sim)
    if (!simulated.ok || !result.success || !result.data || !simDiagnostics.success) {
      logger.warn('compiler simulate failed', { status: simulated.status })
      return NextResponse.json({ error: 'Simulator is unavailable' }, { status: 502 })
    }
    const body: SvSimulateResponse = {
      diagnostics: [...diagnostics.data.diagnostics, ...simDiagnostics.data.diagnostics],
      result: result.data,
    }
    return NextResponse.json(body)
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'Compiler is not configured' }, { status: 503 })
    }
    logger.warn('compiler unreachable', { error: getErrorMessage(error, 'unreachable') })
    return NextResponse.json({ error: 'Compiler is unavailable' }, { status: 502 })
  }
})
