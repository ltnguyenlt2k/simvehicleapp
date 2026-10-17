import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svCreateTestCaseContract, svListTestCasesContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeSvWorkflow } from '@/lib/sv/server/authorize-workflow'
import { createTestCase, listTestCases } from '@/lib/sv/server/test-cases'

const logger = createLogger('SvTestCasesAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** At most this many test cases per workflow (each becomes a generated test). */
const MAX_CASES = 50

/** Test cases of the workflow in order (ADR-0058 §1, M18-T02). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await authorizeSvWorkflow((await context.params).id, 'read')
  if (denied) return denied
  const parsed = await parseRequest(svListTestCasesContract, request, context)
  if (!parsed.success) return parsed.response
  return NextResponse.json({ cases: await listTestCases(parsed.data.params.id) })
})

/** A new test case, last in the list. */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await authorizeSvWorkflow((await context.params).id, 'write')
  if (denied) return denied
  const parsed = await parseRequest(svCreateTestCaseContract, request, context)
  if (!parsed.success) return parsed.response
  const workflowId = parsed.data.params.id
  if ((await listTestCases(workflowId)).length >= MAX_CASES) {
    return NextResponse.json(
      { error: `A workflow has at most ${MAX_CASES} test cases` },
      { status: 409 }
    )
  }
  const created = await createTestCase(workflowId, parsed.data.body.name, parsed.data.body.scenario)
  logger.info('Test case created', { workflowId, caseId: created.id })
  return NextResponse.json(created)
})
