import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { svCatalogSearchContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { forwardCatalogRequest } from '@/lib/sv/catalog-proxy'

export const dynamic = 'force-dynamic'

/** Fuzzy VSS search for the Vehicle panel and the path selector (M02-T12, ADR-0010). */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(svCatalogSearchContract, request, {})
  if (!parsed.success) return parsed.response
  return forwardCatalogRequest('/search', parsed.data.query)
})
