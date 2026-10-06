import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
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

/** VSS release tag, e.g. `v4.0` (openapi/vss-catalog.v1.yaml `Release`). */
export const svVssReleaseSchema = z
  .string()
  .regex(/^v[0-9]+\.[0-9]+$/, 'release must look like v4.0')
/** VSS path below the root branch (contracts `common#/$defs/vssPath`). */
export const svVssPathSchema = z
  .string()
  .regex(
    /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/,
    'path must be a VSS path such as Vehicle.Speed'
  )
export const svVssNodeKindSchema = z.enum(['branch', 'sensor', 'actuator', 'attribute'])
export const svVssDataTypeSchema = z.enum([
  'boolean',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'float',
  'double',
  'string',
  'boolean[]',
  'int8[]',
  'int16[]',
  'int32[]',
  'int64[]',
  'uint8[]',
  'uint16[]',
  'uint32[]',
  'uint64[]',
  'float[]',
  'double[]',
  'string[]',
])
const svVssScalarValueSchema = z.union([z.string(), z.number(), z.boolean()])

/** One catalog node (openapi/vss-catalog.v1.yaml `VssNode`, ADR-0010 §5); int64/uint64 values are decimal strings. */
export const svVssNodeSchema = z.object({
  path: svVssPathSchema,
  name: z.string(),
  kind: svVssNodeKindSchema,
  datatype: svVssDataTypeSchema.optional(),
  unit: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  allowed: z.array(svVssScalarValueSchema).optional(),
  default: z.union([svVssScalarValueSchema, z.array(svVssScalarValueSchema)]).optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
  deprecation: z.string().optional(),
  uuid: z.string().optional(),
  hasChildren: z.boolean().optional(),
})

export const svCatalogNodesResponseSchema = z.object({
  release: svVssReleaseSchema,
  nodes: z.array(svVssNodeSchema),
  unknown: z.array(svVssPathSchema).optional(),
})

export const svCatalogReleasesResponseSchema = z.object({
  releases: z.array(z.object({ release: svVssReleaseSchema, default: z.boolean().optional() })),
})

/** `GET /api/sv/catalog/releases` — VSS releases served by vss-catalog (M02-T12). */
export const svCatalogReleasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/catalog/releases',
  response: { mode: 'json', schema: svCatalogReleasesResponseSchema },
})

export const svCatalogTreeQuerySchema = z.object({
  release: svVssReleaseSchema.optional(),
  prefix: svVssPathSchema.optional(),
  depth: z.coerce
    .number()
    .int()
    .min(1, 'depth must be 1..16')
    .max(16, 'depth must be 1..16')
    .optional(),
})

/** `GET /api/sv/catalog/tree` — lazy VSS tree; without `prefix` it starts below `Vehicle`. */
export const svCatalogTreeContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/catalog/tree',
  query: svCatalogTreeQuerySchema,
  response: { mode: 'json', schema: svCatalogNodesResponseSchema },
})

export const svCatalogSearchQuerySchema = z.object({
  q: z.string().min(1, 'q is required').max(200, 'q must be at most 200 characters'),
  type: svVssNodeKindSchema.optional(),
  release: svVssReleaseSchema.optional(),
})

/** `GET /api/sv/catalog/search` — fuzzy search over path, name and description (top 50). */
export const svCatalogSearchContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/catalog/search',
  query: svCatalogSearchQuerySchema,
  response: { mode: 'json', schema: svCatalogNodesResponseSchema },
})

export const svCatalogNodesQuerySchema = z.object({
  /** Comma-separated VSS paths (1..200 per request from the studio). */
  paths: z
    .string()
    .min(1, 'paths is required')
    .refine((v) => v.split(',').length <= 200, 'at most 200 paths per request')
    .refine(
      (v) => v.split(',').every((p) => svVssPathSchema.safeParse(p).success),
      'paths must be VSS paths'
    ),
  release: svVssReleaseSchema.optional(),
})

/** `GET /api/sv/catalog/nodes` — batch lookup; unknown paths come back in `unknown`. */
export const svCatalogNodesContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/catalog/nodes',
  query: svCatalogNodesQuerySchema,
  response: { mode: 'json', schema: svCatalogNodesResponseSchema },
})

export type SvVssNode = z.output<typeof svVssNodeSchema>
export type SvVssNodeKind = z.output<typeof svVssNodeKindSchema>
export type SvCatalogNodesResponse = z.output<typeof svCatalogNodesResponseSchema>
export type SvCatalogReleasesResponse = z.output<typeof svCatalogReleasesResponseSchema>
export type SvCatalogTreeQuery = z.input<typeof svCatalogTreeQuerySchema>
export type SvCatalogSearchQuery = z.input<typeof svCatalogSearchQuerySchema>
export type SvCatalogNodesQuery = z.input<typeof svCatalogNodesQuerySchema>

export const svWorkflowSettingsParamsSchema = z.object({
  id: workflowIdSchema,
})

/** Per-workflow SimVehicleApp settings; `vssRelease: null` = the catalog default release. */
export const svWorkflowSettingsSchema = z.object({
  vssRelease: svVssReleaseSchema.nullable(),
})

export const svUpdateWorkflowSettingsBodySchema = z.object({
  vssRelease: svVssReleaseSchema,
})

/** `GET /api/sv/workflows/[id]/settings` — VSS release of the workflow (M02-T11). */
export const svGetWorkflowSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/workflows/[id]/settings',
  params: svWorkflowSettingsParamsSchema,
  response: { mode: 'json', schema: svWorkflowSettingsSchema },
})

/** `PUT /api/sv/workflows/[id]/settings` — pin the workflow to a VSS release served by vss-catalog. */
export const svUpdateWorkflowSettingsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/sv/workflows/[id]/settings',
  params: svWorkflowSettingsParamsSchema,
  body: svUpdateWorkflowSettingsBodySchema,
  response: { mode: 'json', schema: svWorkflowSettingsSchema },
})

export type SvWorkflowSettings = z.output<typeof svWorkflowSettingsSchema>
export type SvUpdateWorkflowSettingsBody = z.input<typeof svUpdateWorkflowSettingsBodySchema>

/** One compiler diagnostic (contracts `diagnostics.v1`, ADR-0016); `code` is public API. */
export const svDiagnosticSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  severity: z.enum(['error', 'warning', 'info']),
  stage: z.string(),
  blockId: z.string().optional(),
  field: z.string().optional(),
  nodeId: z.string().optional(),
  workflowId: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional(),
  docs: z.string(),
  // untyped-response: diagnostic data is code-specific (reason, span, value…), ADR-0016 §1
  data: z.record(z.string(), z.unknown()).optional(),
})

export const svLintBodySchema = z.object({
  /** WorkflowGraph v1 built by `lib/sv/graph-adapter.ts`; validated by the compiler (GRAPH_SCHEMA_INVALID). */
  graph: z.record(z.string(), z.unknown()),
})

export const svLintResponseSchema = z.object({ diagnostics: z.array(svDiagnosticSchema) })

/** `POST /api/sv/lint` — realtime canvas lint through the compiler (M03-T11, analysis/05 §4). */
export const svLintContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/lint',
  body: svLintBodySchema,
  response: { mode: 'json', schema: svLintResponseSchema },
})

/** `POST /api/sv/verify` — full compile without IR (S0–S6 + types/units, M04-T11, analysis/06 §3). */
export const svVerifyContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/verify',
  body: svLintBodySchema,
  response: { mode: 'json', schema: svLintResponseSchema },
})

export type SvDiagnostic = z.output<typeof svDiagnosticSchema>
export type SvLintResponse = z.output<typeof svLintResponseSchema>

const svScenarioValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
])
const svScenarioTimeSchema = z.number().int().min(0).max(86_400_000)

/** One scenario input: a VSS signal value or an MQTT message at virtual time `t` (contracts `scenario` v1). */
export const svScenarioInputSchema = z.union([
  z
    .object({ t: svScenarioTimeSchema, path: svVssPathSchema, value: svScenarioValueSchema })
    .strict(),
  z
    .object({
      t: svScenarioTimeSchema,
      topic: z.string().min(1).max(256),
      value: svScenarioValueSchema,
    })
    .strict(),
])

/** Simulation scenario (contracts `scenario` v1, ADR-0017 §3): initial values, inputs over time, optional expectations. */
export const svScenarioSchema = z
  .object({
    scenarioVersion: z.literal('1.0.0'),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    vss: z.object({ release: svVssReleaseSchema }).strict().optional(),
    until: svScenarioTimeSchema,
    initial: z.record(svVssPathSchema, svScenarioValueSchema).optional(),
    latency: z
      .object({
        read: z.number().int().min(0).optional(),
        write: z.number().int().min(0).optional(),
      })
      .strict()
      .optional(),
    inputs: z.array(svScenarioInputSchema).max(10_000, 'at most 10 000 inputs'),
    expect: z
      .object({
        writes: z
          .array(
            z
              .object({ t: svScenarioTimeSchema, path: z.string(), value: svScenarioValueSchema })
              .strict()
          )
          .optional(),
        // untyped-response: partial TraceEvent matchers are free-form by design (contracts `scenario`)
        trace: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const svScenarioResponseSchema = z.object({ scenario: svScenarioSchema.nullable() })
export const svUpdateScenarioBodySchema = z.object({ scenario: svScenarioSchema })

/** `GET /api/sv/workflows/[id]/scenario` — the workflow's simulation scenario, `null` when none was saved (M05-T09). */
export const svGetScenarioContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/workflows/[id]/scenario',
  params: svWorkflowSettingsParamsSchema,
  response: { mode: 'json', schema: svScenarioResponseSchema },
})

/** `PUT /api/sv/workflows/[id]/scenario` — save the simulation scenario (M05-T09). */
export const svUpdateScenarioContract = defineRouteContract({
  method: 'PUT',
  path: '/api/sv/workflows/[id]/scenario',
  params: svWorkflowSettingsParamsSchema,
  body: svUpdateScenarioBodySchema,
  response: { mode: 'json', schema: svScenarioResponseSchema },
})

/** TraceEvent v1 (contracts `trace-event`, ADR-0027) as produced by the simulator. */
export const svTraceEventSchema = z.object({
  runId: z.string(),
  seq: z.number().int().min(0),
  ts: z.number().int().min(0),
  wf: z.string().optional(),
  run: z.number().int().min(0).optional(),
  node: z.string().optional(),
  blockId: z.string().optional(),
  ev: z.string(),
  // untyped-response: event payload depends on `ev` (outputs, write, log, reason…), contracts `trace-event`
  data: z.record(z.string(), z.unknown()).optional(),
})

const svTimedValueSchema = z.object({
  t: z.number().int().min(0),
  path: z.string(),
  value: z.unknown(),
})

export const svSimulateBodySchema = z.object({
  /** WorkflowGraph v1 from the canvas; the BFF compiles it, then simulates the IR. */
  graph: z.record(z.string(), z.unknown()),
  scenario: svScenarioSchema,
})

export const svSimulateResponseSchema = z.object({
  /** Compile diagnostics, plus SIM_LIMIT_REACHED when the simulation hit its event cap. */
  diagnostics: z.array(svDiagnosticSchema),
  /** Absent when the graph does not compile. */
  result: z
    .object({
      trace: z.array(svTraceEventSchema),
      writes: z.array(svTimedValueSchema),
      signals: z.array(svTimedValueSchema),
      publishes: z.array(
        z.object({ t: z.number().int().min(0), topic: z.string(), payload: z.string() })
      ),
      logs: z.array(
        z.object({ t: z.number().int().min(0), level: z.string(), message: z.string() })
      ),
      expectations: z.object({ passed: z.boolean(), mismatches: z.array(z.string()) }).optional(),
    })
    .optional(),
})

/** `POST /api/sv/simulate` — compile the canvas graph and simulate it with a scenario (M05-T09/T10, ADR-0017). */
export const svSimulateContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/simulate',
  body: svSimulateBodySchema,
  response: { mode: 'json', schema: svSimulateResponseSchema },
})

export type SvScenario = z.output<typeof svScenarioSchema>
export type SvScenarioInput = z.output<typeof svScenarioInputSchema>
export type SvTraceEvent = z.output<typeof svTraceEventSchema>
export type SvSimulateResponse = z.output<typeof svSimulateResponseSchema>
