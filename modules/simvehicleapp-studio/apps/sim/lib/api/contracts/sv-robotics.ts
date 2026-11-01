import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Robot-domain BFF contracts (ADR-0068 §4). The studio forwards to `robotics-control` (robotics/control); the
 * browser never picks an execution URL or sends code — only the robotflow.v1 document built by the adapter.
 */

export const svRobotModeSchema = z.enum(['mock', 'ros-sim'])

const robotFlowNodeSchema = z.object({
  id: z.string().min(1).max(96),
  block: z.string().min(1).max(64),
  label: z.string().max(96),
  props: z.record(z.string(), z.union([z.string().max(2000), z.number(), z.boolean()])),
})

export const svRobotFlowSchema = z.object({
  schema: z.literal('robotflow.v1'),
  rss: z.object({ version: z.literal('0.1'), catalogHash: z.string().max(80) }),
  profile: z.string().min(1).max(64),
  source: z.object({ workflowId: z.string().max(128), name: z.string().max(200) }),
  nodes: z.array(robotFlowNodeSchema).max(500),
  edges: z
    .array(
      z.object({
        from: z.tuple([z.string().max(96), z.string().max(32)]),
        to: z.tuple([z.string().max(96), z.literal('in')]),
      })
    )
    .max(2000),
})

export const svRobotDiagnosticSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  nodeId: z.string().optional(),
  prop: z.string().optional(),
})

const robotWorkflowBodySchema = z.object({
  workflowId: workflowIdSchema,
  mode: svRobotModeSchema.default('mock'),
  workflow: svRobotFlowSchema,
})

export const svRobotLintResponseSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(svRobotDiagnosticSchema),
})

/** `POST /api/sv/robotics/lint` — RobotFlow compiler checks of the canvas. */
export const svRobotLintContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/robotics/lint',
  body: robotWorkflowBodySchema,
  response: { mode: 'json', schema: svRobotLintResponseSchema },
})

export const svRobotBuildResponseSchema = z.object({
  ok: z.boolean(),
  diagnostics: z.array(svRobotDiagnosticSchema),
  build: z
    .object({
      id: z.string(),
      artifactHash: z.string(),
      createdAt: z.number(),
      files: z.array(z.string()),
      signals: z.array(z.string()),
    })
    .optional(),
})

/** `POST /api/sv/robotics/builds` — compile into an immutable Python app (rflowc). */
export const svRobotBuildContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/robotics/builds',
  body: robotWorkflowBodySchema,
  response: { mode: 'json', schema: svRobotBuildResponseSchema },
})

export const svRobotTargetSchema = z.object({
  mode: svRobotModeSchema,
  catalogHash: z.string(),
  providers: z.array(z.string()),
  robotId: z.string().nullable().optional(),
  robotMode: z.string().nullable().optional(),
  scene: z.string().nullable().optional(),
  online: z.boolean().nullable().optional(),
})

export const svRobotDeploymentSchema = z.object({
  id: z.string(),
  buildId: z.string(),
  artifactHash: z.string(),
  mode: svRobotModeSchema,
  target: svRobotTargetSchema,
  createdAt: z.number(),
})

/** `POST /api/sv/robotics/deployments` — bind a build to the observed robot; never starts or arms. */
export const svRobotDeployContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/robotics/deployments',
  body: z.object({
    workflowId: workflowIdSchema,
    buildId: z.string().regex(/^[0-9a-f]{16,64}$/, 'buildId must be a build hash'),
    mode: svRobotModeSchema,
  }),
  response: { mode: 'json', schema: svRobotDeploymentSchema },
})

export const svRobotRunEventSchema = z
  .object({
    seq: z.number(),
    ev: z.string(),
    t: z.number().optional(),
    node: z.string().optional(),
    state: z.string().optional(),
    path: z.string().optional(),
    phase: z.string().optional(),
    level: z.string().optional(),
    message: z.string().optional(),
    requestId: z.string().optional(),
  })
  .passthrough()

export const svRobotRunSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  mode: svRobotModeSchema,
  buildId: z.string(),
  state: z.enum(['running', 'finished', 'failed', 'stopped']),
  exitCode: z.number().nullable(),
  startedAt: z.number(),
  stop: z
    .object({
      confirmed: z.boolean(),
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional(),
    })
    .nullable(),
  events: z.array(svRobotRunEventSchema),
  latestSeq: z.number(),
})

/** `POST /api/sv/robotics/runs` — explicit Start of a deployment (the user confirmed in the studio). */
export const svRobotStartContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/robotics/runs',
  body: z.object({
    workflowId: workflowIdSchema,
    deploymentId: z.string().uuid('deploymentId must be a UUID'),
  }),
  response: { mode: 'json', schema: svRobotRunSchema },
})

const runParamsSchema = z.object({ id: z.string().uuid('run id must be a UUID') })

/** `GET /api/sv/robotics/runs/[id]` — status, trace and logs after `after`. */
export const svRobotRunContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/robotics/runs/[id]',
  params: runParamsSchema,
  query: z.object({ after: z.coerce.number().int().min(0).default(0) }),
  response: { mode: 'json', schema: svRobotRunSchema },
})

/** `POST /api/sv/robotics/runs/[id]/stop` — safety-lane stop, confirmed by the robot, then the app ends. */
export const svRobotStopContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/robotics/runs/[id]/stop',
  params: runParamsSchema,
  response: { mode: 'json', schema: svRobotRunSchema },
})

export const svRobotConfigSchema = z.object({
  zooUrl: z.string(),
  modes: z.array(svRobotModeSchema),
  profile: z.string(),
  targets: z.array(
    z.union([svRobotTargetSchema, z.object({ mode: svRobotModeSchema, error: z.string() })])
  ),
})

/** `GET /api/sv/robotics/config` — Robot Zoo link and the observed targets of both modes. */
export const svRobotConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/robotics/config',
  response: { mode: 'json', schema: svRobotConfigSchema },
})

export type SvRobotMode = z.output<typeof svRobotModeSchema>
export type SvRobotFlow = z.input<typeof svRobotFlowSchema>
export type SvRobotDiagnostic = z.output<typeof svRobotDiagnosticSchema>
export type SvRobotBuildResponse = z.output<typeof svRobotBuildResponseSchema>
export type SvRobotDeployment = z.output<typeof svRobotDeploymentSchema>
export type SvRobotRun = z.output<typeof svRobotRunSchema>
export type SvRobotRunEvent = z.output<typeof svRobotRunEventSchema>
export type SvRobotConfig = z.output<typeof svRobotConfigSchema>
