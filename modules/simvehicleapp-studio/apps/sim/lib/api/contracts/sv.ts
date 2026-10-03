import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Health of one SimVehicleApp service as seen by the studio BFF. */
export const svServiceHealthSchema = z.object({
  service: z.enum(['vss-catalog', 'compiler', 'orchestrator', 'ai-assistant']),
  status: z.enum(['ok', 'degraded', 'down', 'unconfigured']),
  latencyMs: z.number().int().min(0).optional(),
  error: z.string().optional(),
})

export const svHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  services: z.array(svServiceHealthSchema),
})

/** `GET /api/sv/health` — aggregated `/healthz` of the configured SimVehicleApp services (M01-T09). */
export const svHealthContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/health',
  response: { mode: 'json', schema: svHealthResponseSchema },
})

export type SvServiceHealthResponse = z.output<typeof svServiceHealthSchema>
export type SvHealthResponse = z.output<typeof svHealthResponseSchema>
