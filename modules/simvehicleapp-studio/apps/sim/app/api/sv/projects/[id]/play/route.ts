import { type NextRequest, NextResponse } from 'next/server'
import {
  svPlaybackSchema,
  svPlaybackStatusContract,
  svPlayScenarioContract,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  activeSandbox,
  authorizeProject,
  projectOf,
  svJson,
  upstreamError,
} from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Plays a scenario on the project's databroker (M08-T07): the live counterpart of Simulate; on the run's own one when it has a sandbox (ADR-0057). */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svPlayScenarioContract, request, context)
  if (!parsed.success) return parsed.response
  const project = await projectOf(auth.row.id)
  if (project instanceof NextResponse) return project
  const sandbox = await activeSandbox(auth.row.id)
  const res = await svJson('signal-gateway', '/play', {
    method: 'POST',
    body: {
      release: project.vssRelease,
      ...(sandbox ? { sandbox } : {}),
      scenario: parsed.data.body.scenario,
      ...(parsed.data.body.observe?.length ? { observe: parsed.data.body.observe } : {}),
    },
  })
  if (res instanceof NextResponse) return res
  if (res.status !== 202) return upstreamError(res)
  const playback = svPlaybackSchema.safeParse(res.body)
  return playback.success
    ? NextResponse.json(playback.data, { status: 202 })
    : NextResponse.json({ error: 'Signal gateway returned an invalid playback' }, { status: 502 })
})

/** The current or last playback of the app (Play on the vehicle stack, M18-T04): its state and what the app did. */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svPlaybackStatusContract, request, context)
  if (!parsed.success) return parsed.response
  const sandbox = await activeSandbox(auth.row.id)
  const res = await svJson(
    'signal-gateway',
    `/play${sandbox ? `?sandbox=${encodeURIComponent(sandbox)}` : ''}`
  )
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const playback = svPlaybackSchema.safeParse(res.body)
  return playback.success
    ? NextResponse.json(playback.data)
    : NextResponse.json({ error: 'Signal gateway returned an invalid playback' }, { status: 502 })
})
