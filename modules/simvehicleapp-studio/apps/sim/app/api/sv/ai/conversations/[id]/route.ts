import { type NextRequest, NextResponse } from 'next/server'
import { svAiConversationContract, svAiConversationSchema } from '@/lib/api/contracts/sv-ai'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { AI_USER_HEADER, aiUser } from '@/lib/sv/ai'
import { aiJson } from '@/lib/sv/ai-json'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** A conversation of the user (another user's is "not found" upstream). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const user = await aiUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(svAiConversationContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await aiJson(`/conversations/${encodeURIComponent(parsed.data.params.id)}`, {
    [AI_USER_HEADER]: user.userId,
  })
  if (res instanceof NextResponse) return res
  const conversation = svAiConversationSchema.safeParse(res)
  if (!conversation.success) {
    return NextResponse.json(
      { error: 'AI assistant returned an invalid conversation' },
      { status: 502 }
    )
  }
  return NextResponse.json(conversation.data)
})
