import { type NextRequest, NextResponse } from 'next/server'
import {
  type SvSystemService,
  type SvSystemStatus,
  svSystemServiceSchema,
  svSystemStatusContract,
} from '@/lib/api/contracts/sv'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { callSvService, checkSvServiceHealth, SV_SERVICES } from '@/lib/sv/api-client'
import packageJson from '@/package.json'

export const dynamic = 'force-dynamic'

interface VersionInfo {
  version?: string
  commit?: string
  contracts?: string
}

/** `/version` of a service the studio calls directly (empty when unreachable). */
async function versionOf(service: (typeof SV_SERVICES)[number]): Promise<VersionInfo> {
  try {
    const res = await callSvService(service, '/version')
    return res.ok ? ((await res.json()) as VersionInfo) : {}
  } catch {
    return {}
  }
}

/** The services the orchestrator drives, as it sees them (`GET /system`). */
async function orchestratorView(): Promise<SvSystemService[]> {
  try {
    const res = await callSvService('orchestrator', '/system')
    if (!res.ok) return []
    const body = (await res.json()) as { services?: unknown[] }
    return (body.services ?? []).flatMap((s) => {
      const parsed = svSystemServiceSchema.safeParse({ ...(s as object), via: 'orchestrator' })
      return parsed.success ? [parsed.data] : []
    })
  } catch {
    return []
  }
}

/** System status (M11-T05, ADR-0033 §4): health and version of every SimVehicleApp service. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(svSystemStatusContract, request, {})
  if (!parsed.success) return parsed.response

  const direct = await Promise.all(
    SV_SERVICES.map(async (service): Promise<SvSystemService> => {
      const [health, info] = await Promise.all([checkSvServiceHealth(service), versionOf(service)])
      return {
        ...health,
        ...(info.version ? { version: info.version } : {}),
        ...(info.commit ? { commit: info.commit } : {}),
        ...(info.contracts ? { contracts: info.contracts } : {}),
        via: 'studio',
      }
    })
  )
  const body: SvSystemStatus = {
    studio: { version: packageJson.version, commit: process.env.SV_COMMIT ?? 'unknown' },
    services: [...direct, ...(await orchestratorView())],
  }
  return NextResponse.json(body)
})
