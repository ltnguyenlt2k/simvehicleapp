import { type NextRequest, NextResponse } from 'next/server'
import { svProjectFilesContract, svProjectFilesSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** Files of the project folder and its retained generations (generated-files viewer, M07-T19). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svProjectFilesContract, request, context)
  if (!parsed.success) return parsed.response
  const res = await orchestrator(`/projects/${auth.row.id}/files`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const files = svProjectFilesSchema.safeParse(res.body)
  if (!files.success) {
    return NextResponse.json(
      { error: 'Orchestrator returned an invalid file list' },
      { status: 502 }
    )
  }
  return NextResponse.json(files.data)
})
