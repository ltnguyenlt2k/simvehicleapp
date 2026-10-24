import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Health of one SimVehicleApp service as seen by the studio BFF. */
export const svServiceHealthSchema = z.object({
  service: z.enum(['vss-catalog', 'compiler', 'orchestrator', 'signal-gateway', 'ai-assistant']),
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

/** One service on the System status page (ADR-0033 §4). */
export const svSystemServiceSchema = z.object({
  service: z.string(),
  status: z.enum(['ok', 'degraded', 'down', 'unconfigured']),
  version: z.string().optional(),
  commit: z.string().optional(),
  contracts: z.string().optional(),
  latencyMs: z.number().int().min(0).optional(),
  error: z.string().optional(),
  /** Checked by the studio BFF directly, or through the orchestrator (services it drives). */
  via: z.enum(['studio', 'orchestrator']),
})

export const svSystemStatusSchema = z.object({
  studio: z.object({ version: z.string(), commit: z.string() }),
  services: z.array(svSystemServiceSchema),
})

/** `GET /api/sv/system` — every SimVehicleApp service with health and version (System status page). */
export const svSystemStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/system',
  response: { mode: 'json', schema: svSystemStatusSchema },
})

export type SvSystemStatus = z.output<typeof svSystemStatusSchema>
export type SvSystemService = z.output<typeof svSystemServiceSchema>

export type SvServiceHealthResponse = z.output<typeof svServiceHealthSchema>
export type SvHealthResponse = z.output<typeof svHealthResponseSchema>

/** VSS release tag, e.g. `v4.0` (openapi/vss-catalog.v1.yaml `Release`). */
export const svVssReleaseSchema = z
  .string()
  .regex(/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/, 'release must look like v4.0')
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

/** Within a 1.1 expectation: accepted at `t ≤ actual ≤ t + within` ms (ADR-0058 §9). */
const svWithinSchema = z.number().int().min(0).max(60_000).optional()

/**
 * Simulation scenario (contracts `scenario` v1, ADR-0017 §3): initial values, inputs over time, optional expectations.
 * 1.1 (ADR-0058 §9): expectations are a subset, with `within` and `never`.
 */
export const svScenarioSchema = z
  .object({
    scenarioVersion: z.enum(['1.0.0', '1.1.0']),
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
              .object({
                t: svScenarioTimeSchema,
                path: z.string(),
                value: svScenarioValueSchema,
                within: svWithinSchema,
              })
              .strict()
          )
          .optional(),
        publishes: z
          .array(
            z
              .object({
                t: svScenarioTimeSchema,
                topic: z.string().min(1).max(256),
                payload: z.string().max(10_000),
                within: svWithinSchema,
              })
              .strict()
          )
          .optional(),
        never: z
          .array(
            z
              .object({
                path: svVssPathSchema,
                from: svScenarioTimeSchema.optional(),
                to: svScenarioTimeSchema.optional(),
              })
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

/** A test case of a workflow (ADR-0058 §1): a named scenario at a position. */
export const svTestCaseSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  scenario: svScenarioSchema,
  position: z.number().int().min(0),
})
export const svTestCaseListSchema = z.object({ cases: z.array(svTestCaseSchema) })
export const svTestCaseParamsSchema = z.object({
  id: z.string().min(1).max(128),
  caseId: z.string().min(1).max(160),
})
export const svCreateTestCaseBodySchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(80),
  scenario: svScenarioSchema,
})
export const svUpdateTestCaseBodySchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(80).optional(),
    scenario: svScenarioSchema.optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((b) => b.name !== undefined || b.scenario !== undefined || b.position !== undefined, {
    message: 'nothing to change',
  })

/** `GET /api/sv/workflows/[id]/test-cases` — the workflow's test cases in order (ADR-0058, M18-T02). */
export const svListTestCasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/workflows/[id]/test-cases',
  params: svWorkflowSettingsParamsSchema,
  response: { mode: 'json', schema: svTestCaseListSchema },
})

/** `POST /api/sv/workflows/[id]/test-cases` — a new test case, last in the list. */
export const svCreateTestCaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/workflows/[id]/test-cases',
  params: svWorkflowSettingsParamsSchema,
  body: svCreateTestCaseBodySchema,
  response: { mode: 'json', schema: svTestCaseSchema },
})

/** `PATCH /api/sv/workflows/[id]/test-cases/[caseId]` — rename, edit or move a test case. */
export const svUpdateTestCaseContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/sv/workflows/[id]/test-cases/[caseId]',
  params: svTestCaseParamsSchema,
  body: svUpdateTestCaseBodySchema,
  response: { mode: 'json', schema: svTestCaseSchema },
})

/** `DELETE /api/sv/workflows/[id]/test-cases/[caseId]`. */
export const svDeleteTestCaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/sv/workflows/[id]/test-cases/[caseId]',
  params: svTestCaseParamsSchema,
  response: { mode: 'json', schema: z.object({ deleted: z.boolean() }) },
})

export type SvTestCase = z.output<typeof svTestCaseSchema>

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

// ---- Projects and SynCode (M07-T17…T19, orchestrator.v1 + workspace.v1) ----------------------------

const svProjectSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes (≤ 63)')
export const svProjectIdSchema = z.string().min(1).max(128)

export const svProjectSchema = z.object({
  id: svProjectIdSchema,
  slug: svProjectSlugSchema,
  name: z.string(),
  appName: z.string(),
  language: z.enum(['cpp', 'python', 'rust']),
  vssRelease: z.string(),
  settings: z.object({
    mqttTopicPrefix: z.string(),
    traceLevel: z.enum(['off', 'trigger', 'node']),
  }),
  /** `creating` until the workspace and the toolchain have prepared the project folder. */
  status: z.enum(['creating', 'ready', 'failed']),
  statusMessage: z.string().optional(),
  workflows: z.array(z.object({ simWorkflowId: z.string(), enabled: z.boolean() })),
  /** code-server on the project folder (ADR-0028 §2) once the project is ready. */
  editor: z.object({ url: z.string() }).optional(),
  /** Epoch ms (ADR-0053). */
  createdAt: z.number().int().optional(),
  updatedAt: z.number().int().optional(),
})

export const svProjectListQuerySchema = z.object({ workspaceId: workspaceIdSchema })
export const svProjectListSchema = z.object({ projects: z.array(svProjectSchema) })

/** `GET /api/sv/projects?workspaceId=` — vehicle-app projects of a workspace. */
export const svListProjectsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects',
  query: svProjectListQuerySchema,
  response: { mode: 'json', schema: svProjectListSchema },
})

export const svCreateProjectBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: z.string().trim().min(1, 'name is required').max(200),
  slug: svProjectSlugSchema,
  vssRelease: z
    .string()
    .regex(/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/, 'a VSS release like v4.0'),
  workflowIds: z.array(workflowIdSchema).max(500),
  /** Language of the generated app (ADR-0040, ADR-0041); the stack must have its backend and toolchain. */
  language: z.enum(['cpp', 'python', 'rust']).default('cpp'),
})

/** `POST /api/sv/projects` — create a C++ or Python project in the workspace and assign workflows. */
export const svCreateProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects',
  body: svCreateProjectBodySchema,
  response: { mode: 'json', schema: svProjectSchema },
})

export const svProjectParamsSchema = z.object({ id: svProjectIdSchema })

/** `GET /api/sv/projects/[id]`. */
export const svGetProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svProjectSchema },
})

/** `DELETE /api/sv/projects/[id]` — deletes the vehicle app: its run, folder, caches and history (ADR-0053). */
export const svDeleteProjectContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/sv/projects/[id]',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: z.object({ deleted: z.literal(true) }) },
})

/** `POST /api/sv/projects/[id]/repair` — re-creates a failed vehicle app, keeping its workflows (ADR-0053). */
export const svRepairProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/repair',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svProjectSchema },
})

export const svFreedSchema = z.object({ freedBytes: z.number().int().min(0) })

/** `POST /api/sv/projects/[id]/clean` — removes the app's build outputs; sources stay (ADR-0053). */
export const svCleanProjectContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/clean',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svFreedSchema },
})

export const svProjectSizeSchema = z.object({
  bytes: z.number().int().min(0),
  /** What clean would free. */
  buildBytes: z.number().int().min(0),
})

/** `GET /api/sv/projects/[id]/size` — disk usage of the vehicle app (ADR-0053). */
export const svProjectSizeContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/size',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svProjectSizeSchema },
})

export const svCapacityLevelSchema = z.enum(['ok', 'low', 'high', 'flood'])

export const svCapacitySchema = z.object({
  /** Free disk of the host's projects volume; null when it cannot be measured right now. */
  disk: z
    .object({
      freeBytes: z.number().int().min(0),
      totalBytes: z.number().int().min(0),
      level: svCapacityLevelSchema,
    })
    .nullable(),
  host: z.object({ apps: z.number().int().min(0), limit: z.number().int().min(0) }),
  workspace: z.object({ apps: z.number().int().min(0), limit: z.number().int().min(0) }),
  queue: z.object({ queued: z.number().int().min(0), limit: z.number().int().min(0) }),
  /** Vehicle runtime (ADR-0057): apps running now against the host's run quota; absent without runs. */
  runs: z
    .object({
      active: z.number().int().min(0),
      limit: z.number().int().min(0),
      perUser: z.number().int().min(0),
      sandbox: z.boolean(),
      maxMinutes: z.number().min(0),
    })
    .optional(),
})
export type SvCapacity = z.output<typeof svCapacitySchema>

/** `POST /api/sv/reconcile` — drops apps of archived workspaces and links to vanished apps (≤ once an hour; ADR-0053). */
export const svReconcileContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/reconcile',
  response: {
    mode: 'json',
    schema: z.object({
      deletedApps: z.number().int().min(0),
      droppedLinks: z.number().int().min(0),
    }),
  },
})

/** `GET /api/sv/capacity?workspaceId=` — disk, app quotas and SynCode queue (Vehicle apps, System status; ADR-0053). */
export const svCapacityContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/capacity',
  query: z.object({ workspaceId: workspaceIdSchema }),
  response: { mode: 'json', schema: svCapacitySchema },
})

export const svUpdateProjectWorkflowsBodySchema = z.object({
  workflowIds: z.array(workflowIdSchema).max(500),
})

/** `PUT /api/sv/projects/[id]/workflows` — the workflows SynCode generates into the project. */
export const svUpdateProjectWorkflowsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/sv/projects/[id]/workflows',
  params: svProjectParamsSchema,
  body: svUpdateProjectWorkflowsBodySchema,
  response: { mode: 'json', schema: svProjectSchema },
})

const svVerdictSchema = z.enum(['passed', 'failed', 'skipped', 'pending'])
export const svGenerationStageNames = [
  'ir',
  'codegen',
  'write',
  'deps',
  'build',
  'format-check',
  'test',
] as const

/** A SynCode generation (Master Plan Appendix A on success, Appendix B on failure). */
export const svGenerationSchema = z.object({
  id: z.string(),
  generationId: z.string(),
  projectId: z.string(),
  state: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']),
  success: z.boolean().optional(),
  stage: z.enum(svGenerationStageNames).optional(),
  stages: z.array(
    z.object({
      name: z.enum(svGenerationStageNames),
      state: z.enum(['pending', 'running', 'passed', 'failed', 'skipped']),
      startedAt: z.number().optional(),
      finishedAt: z.number().optional(),
    })
  ),
  verification: z.object({
    ir: svVerdictSchema,
    format: svVerdictSchema,
    compile: svVerdictSchema,
    tests: svVerdictSchema,
  }),
  diagnostics: z.array(svDiagnosticSchema),
  generatedFiles: z.array(z.string()),
  workflows: z.array(
    z.object({ workflowId: z.string(), revision: z.number(), irHash: z.string() })
  ),
  workflowRevision: z.number().optional(),
  modelHash: z.string().optional(),
  compilerVersion: z.string().optional(),
  backend: z.string().optional(),
  editor: z.object({ url: z.string() }).optional(),
  createdAt: z.number(),
  finishedAt: z.number().optional(),
})

export const svStartGenerationBodySchema = z.object({
  /** Proceed when generated files were edited by hand (they are backed up first). */
  overwriteModified: z.boolean().optional(),
  /** The graph of the workflow open in the editor (fresher than the saved one). */
  open: z
    .object({ workflowId: workflowIdSchema, graph: z.record(z.string(), z.unknown()) })
    .optional(),
})

/** `POST /api/sv/projects/[id]/generations` — SynCode every enabled workflow of the project. */
export const svStartGenerationContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/generations',
  params: svProjectParamsSchema,
  body: svStartGenerationBodySchema,
  response: { mode: 'json', schema: svGenerationSchema },
})

export const svGenerationParamsSchema = z.object({
  id: svProjectIdSchema,
  gid: z.string().min(1).max(128),
})

/** `GET /api/sv/projects/[id]/generations/[gid]`. */
export const svGetGenerationContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/generations/[gid]',
  params: svGenerationParamsSchema,
  response: { mode: 'json', schema: svGenerationSchema },
})

/** `GET /api/sv/projects/[id]/generations/[gid]/events` — SSE of the build log (LogLine v1). */
export const svGenerationEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/generations/[gid]/events',
  params: svGenerationParamsSchema,
  response: { mode: 'stream' },
})

export const svLogLineSchema = z.object({
  runId: z.string(),
  seq: z.number().int().min(0),
  ts: z.number(),
  stream: z.enum(['stdout', 'stderr', 'system']),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  msg: z.string(),
  raw: z.string().optional(),
})

export const svProjectFilesSchema = z.object({
  files: z.array(z.object({ path: z.string(), size: z.number(), owned: z.boolean().optional() })),
  current: z.string().nullable(),
  generations: z.array(z.string()),
})

/** `GET /api/sv/projects/[id]/files` — tree of the project and its retained generations (M07-T19). */
export const svProjectFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/files',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svProjectFilesSchema },
})

export const svProjectFileQuerySchema = z.object({
  path: z.string().min(1).max(1024),
  /** A retained generation: the file as that generation wrote it (diff). */
  generationId: z.string().min(1).max(128).optional(),
})
export const svProjectFileSchema = z.object({ path: z.string(), content: z.string() })

/** `GET /api/sv/projects/[id]/file?path=` — one file, read-only (M07-T19). */
export const svProjectFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/file',
  params: svProjectParamsSchema,
  query: svProjectFileQuerySchema,
  response: { mode: 'json', schema: svProjectFileSchema },
})

// ---- Live runs and signals (M08-T08/T09, orchestrator.v1 runs + signal-gateway.v1) ---------------------

export const svRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  generationId: z.string(),
  state: z.enum(['starting', 'running', 'stopping', 'stopped', 'crashed']),
  vssRelease: z.string(),
  traceLevel: z.enum(['off', 'trigger', 'node']),
  exitCode: z.number().int().optional(),
  diagnostics: z.array(svDiagnosticSchema),
  createdAt: z.number(),
  runningAt: z.number().optional(),
  finishedAt: z.number().optional(),
  /** When the run stops by itself unless extended (ADR-0057, sandboxed runs). */
  expiresAt: z.number().optional(),
  extensions: z.number().int().optional(),
  stopReason: z.enum(['user', 'expired', 'admin']).optional(),
  /** A deployment (ADR-0060): the app runs on a deploy target's signals; simulated input is disabled. */
  deploy: z
    .object({
      targetId: z.string(),
      targetName: z.string(),
      mode: z.enum(['read-only', 'read-write']),
    })
    .optional(),
})

export const svStartRunBodySchema = z.object({
  /** Default: the project's latest generation (it must have passed SynCode). */
  generationId: z.string().min(1).max(128).optional(),
  traceLevel: z.enum(['off', 'trigger', 'node']).optional(),
})

/** `POST /api/sv/projects/[id]/runs` — run the app of the project's latest SynCode on the runtime stack. */
export const svStartRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/runs',
  params: svProjectParamsSchema,
  body: svStartRunBodySchema,
  response: { mode: 'json', schema: svRunSchema },
})

export const svRunListSchema = z.object({ runs: z.array(svRunSchema) })

/** `GET /api/sv/projects/[id]/runs` — the project's recent runs, newest first. */
export const svListRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/runs',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svRunListSchema },
})

/** Run limits in force (ADR-0057): `sandbox` false ⇒ one run at a time on the shared stack, no expiry. */
export const svRunLimitsSchema = z.object({
  sandbox: z.boolean(),
  perUser: z.number().int(),
  total: z.number().int(),
  maxMinutes: z.number(),
  maxExtensions: z.number().int(),
})

export const svMyRunSchema = svRunSchema.extend({
  projectName: z.string(),
  workspaceId: z.string(),
})

export const svMyRunsSchema = z.object({
  runs: z.array(svMyRunSchema),
  limits: svRunLimitsSchema,
})

/** `GET /api/sv/runs` — the apps the signed-in user runs now, in every workspace (My runs, ADR-0057). */
export const svMyRunsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/runs',
  response: { mode: 'json', schema: svMyRunsSchema },
})

export type SvRunLimits = z.output<typeof svRunLimitsSchema>
export type SvMyRun = z.output<typeof svMyRunSchema>
export type SvMyRuns = z.output<typeof svMyRunsSchema>

export const svRunParamsSchema = z.object({
  id: svProjectIdSchema,
  rid: z.string().min(1).max(128),
})

/** `GET /api/sv/projects/[id]/runs/[rid]`. */
export const svGetRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/runs/[rid]',
  params: svRunParamsSchema,
  response: { mode: 'json', schema: svRunSchema },
})

/** `POST /api/sv/projects/[id]/runs/[rid]/stop` — SIGINT, SIGKILL after 5 s. */
export const svStopRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/runs/[rid]/stop',
  params: svRunParamsSchema,
  response: { mode: 'json', schema: svRunSchema },
})

/** `POST /api/sv/projects/[id]/runs/[rid]/extend` — keep a sandboxed run longer (ADR-0057). */
export const svExtendRunContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/runs/[rid]/extend',
  params: svRunParamsSchema,
  response: { mode: 'json', schema: svRunSchema },
})

/** `GET /api/sv/projects/[id]/runs/[rid]/events` — SSE of the run: `log` (LogLine v1) and `trace` (TraceEvent v1). */
export const svRunEventsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/runs/[rid]/events',
  params: svRunParamsSchema,
  response: { mode: 'stream' },
})

export const svSignalFieldSchema = z.enum(['value', 'target'])

/** SignalUpdate v1 (signal-gateway). */
export const svSignalUpdateSchema = z.object({
  path: svVssPathSchema,
  ts: z.number(),
  value: svScenarioValueSchema,
  field: svSignalFieldSchema,
})

export const svSignalStreamQuerySchema = z.object({
  /** Comma-separated VSS paths (≤ 200). */
  paths: z.string().min(1).max(20_000),
})

/** `GET /api/sv/projects/[id]/signals?paths=` — SSE of SignalUpdate v1 on the project's databroker. */
export const svSignalStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/signals',
  params: svProjectParamsSchema,
  query: svSignalStreamQuerySchema,
  response: { mode: 'stream' },
})

/** `GET /api/sv/projects/[id]/messages` — SSE of the app's MQTT messages (`event: message`, Live tab, ADR-0058 §6). */
export const svMessagesStreamContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/messages',
  params: svProjectParamsSchema,
  response: { mode: 'stream' },
})

/** An MQTT message of the app; HMI notifications are JSON on `<prefix>/hmi`. */
export const svMessageSchema = z.object({ topic: z.string(), payload: z.string(), ts: z.number() })
export type SvMessage = z.output<typeof svMessageSchema>

export const svSetSignalBodySchema = z.object({
  path: svVssPathSchema,
  value: svScenarioValueSchema,
  field: svSignalFieldSchema,
})

/** `POST /api/sv/projects/[id]/signals` — inject a value (sensor current value or actuator target). */
export const svSetSignalContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/signals',
  params: svProjectParamsSchema,
  body: svSetSignalBodySchema,
  response: { mode: 'json', schema: svSignalUpdateSchema },
})

export const svPlaybackSchema = z.object({
  id: z.string(),
  release: z.string(),
  name: z.string(),
  state: z.enum(['playing', 'done', 'stopped', 'failed']),
  until: z.number(),
  played: z.number(),
  total: z.number(),
  startedAt: z.number(),
  error: z.string().optional(),
  /** What the app did during the playback (ms from its start), for the signals asked in `observe` (ADR-0058 §4). */
  observed: z
    .array(
      z.object({
        t: z.number(),
        path: z.string(),
        field: z.enum(['value', 'target']),
        value: svScenarioValueSchema,
      })
    )
    .optional(),
})

export const svPlayScenarioBodySchema = z.object({
  scenario: svScenarioSchema,
  observe: z.array(svVssPathSchema).max(200).optional(),
})

/** `POST /api/sv/projects/[id]/play` — play a scenario on the project's databroker (M08-T07). */
export const svPlayScenarioContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/play',
  params: svProjectParamsSchema,
  body: svPlayScenarioBodySchema,
  response: { mode: 'json', schema: svPlaybackSchema },
})

/** `GET /api/sv/projects/[id]/play` — the current or last playback of the project's app (Play on the vehicle stack). */
export const svPlaybackStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/play',
  params: svProjectParamsSchema,
  response: { mode: 'json', schema: svPlaybackSchema },
})

/** `GET /api/sv/projects/[id]/export` — the project zip (M09-T06): download, re-buildable outside SimVehicleApp. */
export const svExportProjectContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/projects/[id]/export',
  params: svProjectParamsSchema,
  response: { mode: 'binary' },
})

export type SvRun = z.output<typeof svRunSchema>
export type SvSignalUpdate = z.output<typeof svSignalUpdateSchema>
export type SvSignalField = z.output<typeof svSignalFieldSchema>
export type SvPlayback = z.output<typeof svPlaybackSchema>

export type SvProject = z.output<typeof svProjectSchema>
export type SvCreateProjectBody = z.input<typeof svCreateProjectBodySchema>
export type SvGeneration = z.output<typeof svGenerationSchema>
export type SvStartGenerationBody = z.input<typeof svStartGenerationBodySchema>
export type SvLogLine = z.output<typeof svLogLineSchema>
export type SvProjectFiles = z.output<typeof svProjectFilesSchema>

/** A deploy target of the workspace (ADR-0060): a databroker outside the stack; its token never comes back. */
export const svDeployTargetSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  address: z.string(),
  tls: z.boolean(),
  vssRelease: z.string(),
  createdAt: z.number(),
  hasToken: z.boolean(),
})
export const svDeployTargetListSchema = z.object({ targets: z.array(svDeployTargetSchema) })
export const svWorkspaceQuerySchema = z.object({ workspaceId: z.string().min(1).max(128) })

/** `GET /api/sv/deploy-targets?workspaceId=` — the workspace's deploy targets. */
export const svListDeployTargetsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/deploy-targets',
  query: svWorkspaceQuerySchema,
  response: { mode: 'json', schema: svDeployTargetListSchema },
})

export const svCreateDeployTargetBodySchema = z.object({
  workspaceId: z.string().min(1).max(128),
  name: z.string().trim().min(1, 'name is required').max(80),
  address: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.-]{1,253}:[0-9]{2,5}$/, 'address must be host:port'),
  tls: z.boolean().optional(),
  token: z.string().max(4096).optional(),
  vssRelease: z
    .string()
    .regex(/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/, 'vssRelease vX.Y'),
})

/** `POST /api/sv/deploy-targets` — add a deploy target (workspace admins). */
export const svCreateDeployTargetContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/deploy-targets',
  body: svCreateDeployTargetBodySchema,
  response: { mode: 'json', schema: svDeployTargetSchema },
})

export const svDeployTargetParamsSchema = z.object({ id: z.string().min(1).max(128) })

/** `DELETE /api/sv/deploy-targets/[id]?workspaceId=` — remove a deploy target (workspace admins). */
export const svDeleteDeployTargetContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/sv/deploy-targets/[id]',
  params: svDeployTargetParamsSchema,
  query: svWorkspaceQuerySchema,
  response: { mode: 'json', schema: z.object({ deleted: z.literal(true) }) },
})

export const svTestDeployTargetResultSchema = z.union([
  z.object({
    reachable: z.literal(true),
    api: z.literal('kuksa.val.v2'),
    server: z.object({ name: z.string().optional(), version: z.string().optional() }),
    missing: z.array(z.string()),
  }),
  z.object({ reachable: z.literal(false), status: z.number(), message: z.string() }),
])

/** `POST /api/sv/deploy-targets/[id]/test` — Test connection: the server, and the paths it lacks. */
export const svTestDeployTargetContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/deploy-targets/[id]/test',
  params: svDeployTargetParamsSchema,
  body: z.object({
    workspaceId: z.string().min(1).max(128),
    paths: z.array(z.string().min(1).max(255)).max(200).optional(),
  }),
  response: { mode: 'json', schema: svTestDeployTargetResultSchema },
})

/** `POST /api/sv/projects/[id]/deployments` — deploy the app's latest SynCode to a target. */
export const svStartDeploymentContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/projects/[id]/deployments',
  params: svProjectParamsSchema,
  body: z.object({
    targetId: z.string().min(1).max(128),
    mode: z.enum(['read-only', 'read-write']),
  }),
  response: { mode: 'json', schema: svRunSchema },
})

export type SvDeployTarget = z.output<typeof svDeployTargetSchema>
export type SvCreateDeployTargetBody = z.input<typeof svCreateDeployTargetBodySchema>
export type SvTestDeployTargetResult = z.output<typeof svTestDeployTargetResultSchema>
export type SvDeployMode = 'read-only' | 'read-write'
