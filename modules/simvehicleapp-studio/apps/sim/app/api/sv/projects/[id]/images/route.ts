import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { svPushImageContract, svPushImageResultSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

const logger = createLogger('SvImagesAPI')

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Deploy as a container image (ADR-0060, M18-T10): the app of the latest SynCode packed as an OCI image (FROM
 * scratch: the binary, its libraries, the AppManifest and notices) and pushed to the registry. Answers when pushed.
 */
export const POST = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'write')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svPushImageContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/images`, {
    method: 'POST',
    body: parsed.data.body,
    timeoutMs: 900_000,
  })
  if (res instanceof NextResponse) return res
  if (res.status === 409 || res.status === 422) {
    const message = (res.body as { message?: string } | null)?.message
    return NextResponse.json(
      { error: message ?? 'The image was not pushed' },
      { status: res.status }
    )
  }
  if (res.status !== 200) return upstreamError(res)
  const result = svPushImageResultSchema.safeParse(res.body)
  if (!result.success)
    return NextResponse.json({ error: 'Unexpected orchestrator answer' }, { status: 502 })
  logger.info('Image pushed', {
    project: auth.row.id,
    reference: result.data.reference,
    digest: result.data.digest,
  })
  return NextResponse.json(result.data)
})
