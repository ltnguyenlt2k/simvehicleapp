import { type NextRequest, NextResponse } from 'next/server'
import { svMessagesStreamContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, projectOf } from '@/lib/sv/projects'
import { relaySse } from '@/lib/sv/sse-relay'

export const dynamic = 'force-dynamic'

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
  return relaySse('signal-gateway', `/messages?${query}`, request)
})
