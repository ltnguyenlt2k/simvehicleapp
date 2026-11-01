import { NextResponse } from 'next/server'
import { svRobotConfigSchema } from '@/lib/api/contracts/sv-robotics'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { requireSession, roboticsJson } from '@/lib/sv/server/robotics'

export const dynamic = 'force-dynamic'

/** Robot Zoo link and the robot observed on each mode (shown before Deploy/Start). */
export const GET = withRouteHandler(async () => {
  const denied = await requireSession()
  if (denied) return denied
  const config = await roboticsJson('/config')
  if (config instanceof NextResponse) return config
  const targets = await Promise.all(
    (['mock', 'ros-sim'] as const).map(async (mode) => {
      const target = await roboticsJson(`/targets/${mode}`, { timeoutMs: 5000 })
      return target instanceof NextResponse ? { mode, error: 'robot bus unavailable' } : target.body
    })
  )
  return NextResponse.json(svRobotConfigSchema.parse({ ...(config.body as object), targets }))
})
