import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { callSvService, SvServiceNotConfiguredError } from '@/lib/sv/api-client'
import { authorizeSvWorkflow } from '@/lib/sv/server/authorize-workflow'

const logger = createLogger('SvRobotics')

/**
 * Calls robotics-control (ADR-0068 §4) and returns its JSON, or an error response the editor can show:
 * 4xx details of the control API are user-facing (e.g. "the robot catalog differs from the build"),
 * outages become 502/503 without upstream internals.
 */
export async function roboticsJson(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<{ body: unknown } | NextResponse> {
  let response: Response
  try {
    response = await callSvService('robotics', path, {
      method: init.method ?? 'GET',
      body: init.body,
      timeoutMs: init.timeoutMs ?? 10000,
      retryOnReset: (init.method ?? 'GET') === 'GET',
    })
  } catch (error) {
    if (error instanceof SvServiceNotConfiguredError) {
      return NextResponse.json(
        { error: 'Robotics is not configured (SV_ROBOTICS_URL)' },
        { status: 503 }
      )
    }
    logger.warn('robotics-control unreachable', {
      path,
      error: getErrorMessage(error, 'unreachable'),
    })
    return NextResponse.json({ error: 'Robotics service is unavailable' }, { status: 502 })
  }
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : 'Robotics request failed'
    const status = response.status >= 500 ? 502 : response.status
    return NextResponse.json({ error: detail }, { status: response.status === 503 ? 503 : status })
  }
  return { body }
}

/** Signed-in user with the given permission on the workflow the robot request belongs to. */
export function authorizeRobotWorkflow(
  workflowId: string,
  action: 'read' | 'write'
): Promise<NextResponse | null> {
  return authorizeSvWorkflow(workflowId, action)
}

/** Signed-in user (run status/stop are tied to a run id the user started from a workflow). */
export async function requireSession(): Promise<NextResponse | null> {
  const session = await getSession()
  return session?.user?.id ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
