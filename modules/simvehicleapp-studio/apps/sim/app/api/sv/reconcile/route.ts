import { type NextRequest, NextResponse } from 'next/server'
import { svReconcileContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { reconcileApps } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

/**
 * Drops what nothing can reach any more (ADR-0053 §B.7): apps of archived workspaces and links to apps the
 * orchestrator no longer has. The Vehicle apps page calls it in the background; the work runs at most once an hour
 * per server process and touches no live workspace, so any signed-in user may trigger it.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svReconcileContract, request, {})
  if (!parsed.success) return parsed.response
  return NextResponse.json(await reconcileApps())
})
