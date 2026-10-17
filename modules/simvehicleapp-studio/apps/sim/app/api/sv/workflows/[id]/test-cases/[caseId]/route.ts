import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svDeleteTestCaseContract, svUpdateTestCaseContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeSvWorkflow } from '@/lib/sv/server/authorize-workflow'
import { deleteTestCase, updateTestCase } from '@/lib/sv/server/test-cases'

const logger = createLogger('SvTestCaseAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; caseId: string }> }

/** Rename, edit or move a test case (ADR-0058, M18-T02). */
export const PATCH = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await authorizeSvWorkflow((await context.params).id, 'write')
  if (denied) return denied
  const parsed = await parseRequest(svUpdateTestCaseContract, request, context)
  if (!parsed.success) return parsed.response
  const { id, caseId } = parsed.data.params
  const updated = await updateTestCase(id, caseId, parsed.data.body)
  if (!updated) return NextResponse.json({ error: 'Test case not found' }, { status: 404 })
  logger.info('Test case updated', { workflowId: id, caseId })
  return NextResponse.json(updated)
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const denied = await authorizeSvWorkflow((await context.params).id, 'write')
  if (denied) return denied
  const parsed = await parseRequest(svDeleteTestCaseContract, request, context)
  if (!parsed.success) return parsed.response
  const { id, caseId } = parsed.data.params
  const deleted = await deleteTestCase(id, caseId)
  if (!deleted) return NextResponse.json({ error: 'Test case not found' }, { status: 404 })
  logger.info('Test case deleted', { workflowId: id, caseId })
  return NextResponse.json({ deleted })
})
