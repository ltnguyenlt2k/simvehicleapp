import { type NextRequest, NextResponse } from 'next/server'
import { svPlaybackSchema, svPlayScenarioContract } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, projectOf, svJson, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Plays a scenario on the project's databroker (M08-T07): the live counterpart of Simulate. */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svPlayScenarioContract, request, context)
  if (!parsed.success) return parsed.response
  const project = await projectOf(auth.row.id)
  if (project instanceof NextResponse) return project
  const res = await svJson('signal-gateway', '/play', {
    method: 'POST',
    body: { release: project.vssRelease, scenario: parsed.data.body.scenario },
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 202) return upstreamError(res)
  const playback = svPlaybackSchema.safeParse(res.body)
  return playback.success
    ? NextResponse.json(playback.data, { status: 202 })
    : NextResponse.json({ error: 'Signal gateway returned an invalid playback' }, { status: 502 })
})
