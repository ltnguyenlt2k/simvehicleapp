import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'

const logger = createLogger('SvAiJson')

/** JSON GET to the ai-assistant; outages become 502/503 and upstream 404 stays 404. */
export async function aiJson(
  path: string,
  headers: Record<string, string>
): Promise<unknown | NextResponse> {
  let res: Response
  try {
    res = await callSvService('ai-assistant', path, { headers, timeoutMs: 5_000 })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json({ error: 'AI assistant is not configured' }, { status: 503 })
    }
    logger.warn('ai-assistant unreachable', { path: path.split('?')[0] })
    return NextResponse.json({ error: 'AI assistant is unavailable' }, { status: 502 })
  }
  const body = (await res.json().catch(() => null)) as { message?: string } | null
  if (res.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!res.ok) {
    return NextResponse.json({ error: body?.message ?? 'AI assistant error' }, { status: 502 })
  }
  return body
}
