import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svAiChatContract } from '@/lib/api/contracts/sv-ai'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { AI_USER_HEADER, aiTurnContext, aiUser } from '@/lib/sv/ai'
import { relaySse } from '@/lib/sv/sse-relay'

const logger = createLogger('SvAiChatAPI')

export const dynamic = 'force-dynamic'

/** One assistant turn about the open workflow, relayed as SSE (M10-T08). */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const user = await aiUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(svAiChatContract, request, {})
  if (!parsed.success) return parsed.response
  const { message, conversationId, ...editor } = parsed.data.body
  const context = await aiTurnContext(user.userId, editor)
  if (context instanceof NextResponse) return context
  logger.info('assistant turn', {
    workflowId: editor.workflowId,
    project: Boolean(context.project),
  })
  return relaySse('ai-assistant', '/chat', request, {
    method: 'POST',
    body: { message, ...(conversationId ? { conversationId } : {}), context },
    headers: { [AI_USER_HEADER]: user.userId },
  })
})
