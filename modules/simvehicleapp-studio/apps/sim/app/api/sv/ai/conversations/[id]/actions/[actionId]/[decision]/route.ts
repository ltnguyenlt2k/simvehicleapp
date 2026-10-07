import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svAiActionContract } from '@/lib/api/contracts/sv-ai'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { AI_USER_HEADER, aiTurnContext, aiUser } from '@/lib/sv/ai'
import { relaySse } from '@/lib/sv/sse-relay'

const logger = createLogger('SvAiActionAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string; actionId: string; decision: string }> }

/**
 * Confirm (optionally with an edited input) or cancel the pending sensitive action of a
 * conversation; the turn then continues, relayed as SSE (ADR-0030 §6).
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const user = await aiUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(svAiActionContract, request, context)
  if (!parsed.success) return parsed.response
  const { id, actionId, decision } = parsed.data.params
  const { editedInput, ...editor } = parsed.data.body
  const turn = await aiTurnContext(user.userId, editor)
  if (turn instanceof NextResponse) return turn
  logger.info('assistant action', { decision, edited: Boolean(editedInput) })
  return relaySse(
    'ai-assistant',
    `/conversations/${encodeURIComponent(id)}/actions/${encodeURIComponent(actionId)}/${decision}`,
    request,
    {
      method: 'POST',
      body: { context: turn, ...(decision === 'confirm' && editedInput ? { editedInput } : {}) },
      headers: { [AI_USER_HEADER]: user.userId },
    }
  )
})
