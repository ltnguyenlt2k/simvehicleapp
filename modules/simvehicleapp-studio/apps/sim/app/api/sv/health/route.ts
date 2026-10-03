import { type NextRequest, NextResponse } from 'next/server'
import { type SvHealthResponse, svHealthContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { checkSvServiceHealth, SV_SERVICES } from '@/lib/sv/api-client'

export const dynamic = 'force-dynamic'

/**
 * Aggregated health of the SimVehicleApp services behind the studio BFF (M01-T09, ADR-0007).
 * Unconfigured services are reported but do not degrade the overall status.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(svHealthContract, request, {})
  if (!parsed.success) return parsed.response

  const services = await Promise.all(SV_SERVICES.map((service) => checkSvServiceHealth(service)))
  const degraded = services.some((s) => s.status === 'down' || s.status === 'degraded')
  const body: SvHealthResponse = { status: degraded ? 'degraded' : 'ok', services }
  return NextResponse.json(body)
})
