import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svAiStatusContract, svAiStatusSchema } from '@/lib/api/contracts/sv-ai'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { aiUser } from '@/lib/sv/ai'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvAiStatusAPI')

export const dynamic = 'force-dynamic'

/** Whether the assistant can answer (provider configured); never a key. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const user = await aiUser()
  if (user instanceof NextResponse) return user
  const parsed = await parseRequest(svAiStatusContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const res = await callSvService('ai-assistant', '/status')
    const status = svAiStatusSchema.safeParse(await res.json().catch(() => null))
    if (!res.ok || !status.success) {
      return NextResponse.json(
        { error: 'AI assistant returned an invalid status' },
        { status: 502 }
      )
    }
    return NextResponse.json(status.data)
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({
        configured: false,
        reason: 'The AI assistant service is not configured (SV_AI_URL)',
        externalServers: [],
      })
    }
    logger.warn('ai-assistant unreachable')
    return NextResponse.json({ error: 'AI assistant is unavailable' }, { status: 502 })
  }
})
