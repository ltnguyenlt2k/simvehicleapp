import { type NextRequest, NextResponse } from 'next/server'
import { svIdeAuthorizeContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

export const dynamic = 'force-dynamic'

/**
 * Forward-auth for the IDE behind the `remote-ide` reverse proxy (ADR-0050 §2, M21 D15): the proxy sends every IDE
 * request here with the browser's cookies and forwards it to code-server only on 200. The proxy serves the studio and
 * the IDE from one origin, so the studio session cookie comes along.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const parsed = await parseRequest(svIdeAuthorizeContract, request, {})
  if (!parsed.success) return parsed.response
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
})
