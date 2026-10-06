import { type NextRequest, NextResponse } from 'next/server'
import { svProjectFileContract, svProjectFileSchema } from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeProject, orchestrator, upstreamError } from '@/lib/sv/projects'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

/** One file of the project, current or as a retained generation wrote it (read-only, M07-T19). */
export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const auth = await authorizeProject((await context.params).id, 'read')
  if (auth instanceof NextResponse) return auth
  const parsed = await parseRequest(svProjectFileContract, request, context)
  if (!parsed.success) return parsed.response
  const { path, generationId } = parsed.data.query
  const query = new URLSearchParams({ path, ...(generationId ? { generationId } : {}) })
  const res = await orchestrator(`/projects/${auth.row.id}/file?${query}`)
  if (res instanceof NextResponse) return res
  if (res.status !== 200) return upstreamError(res)
  const file = svProjectFileSchema.safeParse(res.body)
  if (!file.success) {
    return NextResponse.json({ error: 'Orchestrator returned an invalid file' }, { status: 502 })
  }
  return NextResponse.json(file.data)
})
