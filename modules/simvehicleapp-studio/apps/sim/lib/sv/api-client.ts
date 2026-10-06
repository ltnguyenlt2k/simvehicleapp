import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { env } from '@/lib/core/config/env'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('SvApiClient')

/** SimVehicleApp services the studio BFF talks to (ADR-0007 dependency matrix: studio → core, orchestrator, ai). */
export const SV_SERVICES = [
  'vss-catalog',
  'compiler',
  'orchestrator',
  'signal-gateway',
  'ai-assistant',
] as const
export type SvService = (typeof SV_SERVICES)[number]

export const INTERNAL_AUTH_HEADER = 'x-sv-internal'
export const REQUEST_ID_HEADER = 'x-sv-request-id'
export const DEFAULT_SERVICE_TIMEOUT_MS = 2000

/** Base URL of a service from its `SV_*_URL` variable, or `undefined` when not configured. */
export function getSvServiceUrl(service: SvService): string | undefined {
  const url = {
    'vss-catalog': env.SV_CATALOG_URL,
    compiler: env.SV_COMPILER_URL,
    orchestrator: env.SV_ORCHESTRATOR_URL,
    'signal-gateway': env.SV_SIGNAL_GATEWAY_URL,
    'ai-assistant': env.SV_AI_URL,
  }[service]
  return url ? url.replace(/\/+$/, '') : undefined
}

export class SvServiceNotConfiguredError extends Error {
  constructor(service: SvService) {
    super(`SimVehicleApp service '${service}' is not configured`)
    this.name = 'SvServiceNotConfiguredError'
  }
}

export interface SvRequestOptions {
  method?: string
  body?: unknown
  timeoutMs?: number
  /** Extra request headers (e.g. `last-event-id` when resuming a stream). */
  headers?: Record<string, string>
  /** Aborts the call with the caller (a client leaving a proxied stream). */
  signal?: AbortSignal
}

/**
 * Calls an internal SimVehicleApp service with the internal auth header and the current request id
 * (ADR-0007 §5-6). Network errors and timeouts propagate to the caller.
 */
export async function callSvService(
  service: SvService,
  path: string,
  {
    method = 'GET',
    body,
    timeoutMs = DEFAULT_SERVICE_TIMEOUT_MS,
    headers: extra,
    signal,
  }: SvRequestOptions = {}
): Promise<Response> {
  const base = getSvServiceUrl(service)
  if (!base) throw new SvServiceNotConfiguredError(service)
  const headers: Record<string, string> = {
    ...extra,
    [INTERNAL_AUTH_HEADER]: env.INTERNAL_API_SECRET,
    [REQUEST_ID_HEADER]: generateRequestId(),
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  return fetch(`${base}${path.startsWith('/') ? path : `/${path}`}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
}

export type SvServiceStatus = 'ok' | 'degraded' | 'down' | 'unconfigured'

export interface SvServiceHealth {
  service: SvService
  status: SvServiceStatus
  latencyMs?: number
  error?: string
}

/** Probes `GET /healthz` of a service (ServiceHealth v1: `{ status: 'ok' | 'degraded' }`). */
export async function checkSvServiceHealth(service: SvService): Promise<SvServiceHealth> {
  if (!getSvServiceUrl(service)) return { service, status: 'unconfigured' }
  const started = Date.now()
  try {
    const response = await callSvService(service, '/healthz')
    const latencyMs = Date.now() - started
    const payload = (await response.json().catch(() => null)) as { status?: unknown } | null
    if (response.ok && payload?.status === 'ok') return { service, status: 'ok', latencyMs }
    return { service, status: 'degraded', latencyMs, error: `HTTP ${response.status}` }
  } catch (error) {
    const message = getErrorMessage(error, 'unreachable')
    logger.warn('Service health check failed', { service, error: message })
    return { service, status: 'down', latencyMs: Date.now() - started, error: message }
  }
}
