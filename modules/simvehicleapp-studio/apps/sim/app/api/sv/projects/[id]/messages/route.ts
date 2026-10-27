import { type NextRequest, NextResponse } from 'next/server'
import { svMessagesStreamContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { calleesFor } from '@/lib/sv/callees'
import { authorizeProject, graphsFor, projectOf } from '@/lib/sv/projects'
import { relaySse } from '@/lib/sv/sse-relay'

export const dynamic = 'force-dynamic'

/** Exact MQTT topics of `sv_mqtt_publish` / `sv_on_mqtt` blocks (no wildcard), at most 20 (signal-gateway limit). */
function appTopics(graphs: Record<string, unknown>[]): string[] {
  const topics = new Set<string>()
  for (const g of graphs) {
    for (const b of (Array.isArray(g.blocks) ? g.blocks : []) as {
      type?: unknown
      props?: Record<string, unknown>
    }[]) {
      const topic = b.props?.topic
      if (
        (b.type === 'sv_mqtt_publish' || b.type === 'sv_on_mqtt') &&
        typeof topic === 'string' &&
        /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(topic)
      )
        topics.add(topic)
    }
  }
  return [...topics].sort().slice(0, 20)
}

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Messages of the Live tab (M18-T05, ADR-0058 §6): the MQTT messages under the app's topic prefix — HMI
 * notifications and other publishes — streamed from the signal-gateway.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svMessagesStreamContract, request, context)
  if (!parsed.success) return parsed.response
  const project = await projectOf(auth.row.id)
  if (project instanceof NextResponse) return project
  const query = new URLSearchParams({ prefix: project.settings.mqttTopicPrefix })
  // Topics the app's own workflows (and the functions they call) publish or listen to outside the prefix — read
  // from their saved graphs, so a user cannot open another app's topics.
  const enabled = project.workflows.filter((w) => w.enabled).map((w) => w.simWorkflowId)
  if (enabled.length > 0 && auth.row.workspaceId) {
    const { graphs } = await graphsFor(auth.row.workspaceId, enabled, project.vssRelease)
    const topics = appTopics([...graphs, ...(await calleesFor(auth.userId, graphs))])
    if (topics.length > 0) query.set('topics', topics.join(','))
  }
  return relaySse('signal-gateway', `/messages?${query}`, request)
})
