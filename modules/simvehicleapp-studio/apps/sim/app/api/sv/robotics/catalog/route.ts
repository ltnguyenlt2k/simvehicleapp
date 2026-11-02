import { NextResponse } from 'next/server'
import { type SvRssNode, svRobotCatalogSchema } from '@/lib/api/contracts/sv-robotics'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

interface CatalogNode {
  kind?: string
  type?: string
  unit?: string
  values?: unknown[]
  description?: string
}

/** RSS catalog of the robot profile as a sorted node list (Toolbar signal tree of robot workflows). */
export const GET = withRouteHandler(async () => {
  const denied = await requireSession()
  if (denied) return denied
  const upstream = await roboticsJson('/catalog')
  if (upstream instanceof NextResponse) return upstream
  const catalog = upstream.body as {
    catalogHash?: string
    rss?: string
    profile?: string | { id?: string }
    nodes?: Record<string, CatalogNode>
  }
  const nodes: SvRssNode[] = Object.entries(catalog.nodes ?? {})
    .map(([path, node]) => ({
      path,
      name: path.split('.').at(-1) ?? path,
      kind: (node.kind ?? 'branch') as SvRssNode['kind'],
      type: node.type,
      unit: node.unit,
      values: node.values?.map(String),
      description: node.description ?? '',
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const profile =
    typeof catalog.profile === 'string' ? catalog.profile : (catalog.profile?.id ?? '')
  return NextResponse.json(
    svRobotCatalogSchema.parse({
      catalogHash: catalog.catalogHash ?? '',
      rss: catalog.rss ?? '',
      profile,
      nodes,
    })
  )
})
