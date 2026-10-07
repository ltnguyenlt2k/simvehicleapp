import { type NextRequest, NextResponse } from 'next/server'
import { svAiConversationsContract } from '@/lib/api/contracts/sv-ai'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { AI_USER_HEADER, aiUser } from '@/lib/sv/ai'
import { aiJson } from '@/lib/sv/ai-json'

export const dynamic = 'force-dynamic'

/** The user's conversations about a workflow, most recent first. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const user = await aiUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(svAiConversationsContract, request, {})
  if (!parsed.success) return parsed.response
  const res = await aiJson('/conversations', { [AI_USER_HEADER]: user.userId })
  if (res instanceof NextResponse) return res
  const all = (res as { conversations?: { workflowId?: string }[] }).conversations ?? []
  return NextResponse.json({
    conversations: all.filter((c) => c.workflowId === parsed.data.query.workflowId),
  })
})
