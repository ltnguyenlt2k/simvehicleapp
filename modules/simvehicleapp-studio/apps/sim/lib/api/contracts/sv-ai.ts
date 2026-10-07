import { z } from 'zod'
import { workflowIdSchema } from '@/lib/api/contracts/primitives'
import { svDiagnosticSchema, svProjectIdSchema } from '@/lib/api/contracts/sv'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Studio BFF for the AI assistant (M10-T08, ADR-0030; contracts `ai-assistant.v1`). The browser
 * never talks to the ai-assistant service: the BFF adds the user and the editor context (open
 * workflow graph, its project's graphs and scenarios) and relays the turn as SSE.
 */

/** `GET /api/sv/ai/status` — whether an LLM provider is configured (never a key). */
export const svAiStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.string().optional(),
  model: z.string().optional(),
  reason: z.string().optional(),
  externalServers: z.array(z.string()).default([]),
})

export const svAiStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/ai/status',
  response: { mode: 'json', schema: svAiStatusSchema },
})

const svAiConversationIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, 'conversationId must be an id (letters, digits, _ . : -)')

/** WorkflowGraph v1 of the canvas (`lib/sv/graph-adapter.ts`); the ai-assistant validates its shape. */
const svAiGraphSchema = z.record(z.string(), z.unknown())

/** Editor context of a turn: the open workflow as on the canvas, and the project it is used in. */
const svAiTurnContextSchema = z.object({
  workflowId: workflowIdSchema,
  graph: svAiGraphSchema,
  projectId: svProjectIdSchema.optional(),
})

export const svAiChatBodySchema = svAiTurnContextSchema.extend({
  message: z.string().trim().min(1, 'message cannot be empty').max(20_000),
  conversationId: svAiConversationIdSchema.optional(),
})

/** `POST /api/sv/ai/chat` — one turn, streamed as SSE (see `svAiEventSchema`). */
export const svAiChatContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/ai/chat',
  body: svAiChatBodySchema,
  response: { mode: 'stream' },
})

export const svAiConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  workflowId: z.string().optional(),
  updatedAt: z.number().optional(),
})

/** `GET /api/sv/ai/conversations?workflowId=` — the user's conversations about a workflow. */
export const svAiConversationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/ai/conversations',
  query: z.object({ workflowId: workflowIdSchema }),
  response: {
    mode: 'json',
    schema: z.object({ conversations: z.array(svAiConversationSummarySchema) }),
  },
})

export const svAiPendingActionSchema = z.object({
  actionId: z.string(),
  toolName: z.string(),
  // untyped-response: the tool input proposed by the LLM, shown and editable before confirming
  toolInput: z.record(z.string(), z.unknown()),
  description: z.string().optional(),
  expiresAt: z.number(),
})

export const svAiConversationSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      tools: z.array(z.object({ name: z.string(), input: z.unknown().optional() })).optional(),
    })
  ),
  pending: svAiPendingActionSchema.omit({ description: true }).optional(),
})

const svAiConversationParamsSchema = z.object({ id: svAiConversationIdSchema })

/** `GET /api/sv/ai/conversations/[id]` — messages for display and the pending action, if any. */
export const svAiConversationContract = defineRouteContract({
  method: 'GET',
  path: '/api/sv/ai/conversations/[id]',
  params: svAiConversationParamsSchema,
  response: { mode: 'json', schema: svAiConversationSchema },
})

export const svAiActionBodySchema = svAiTurnContextSchema.extend({
  /** Confirm only: replaces the input the LLM proposed (ADR-0030 §6). */
  editedInput: z.record(z.string(), z.unknown()).optional(),
})

/** `POST /api/sv/ai/conversations/[id]/actions/[actionId]/[decision]` — confirm or cancel; SSE. */
export const svAiActionContract = defineRouteContract({
  method: 'POST',
  path: '/api/sv/ai/conversations/[id]/actions/[actionId]/[decision]',
  params: svAiConversationParamsSchema.extend({
    actionId: svAiConversationIdSchema,
    decision: z.enum(['confirm', 'cancel']),
  }),
  body: svAiActionBodySchema,
  response: { mode: 'stream' },
})

/** WorkflowPatch summary of a proposal (ai-assistant `patchSummary`). */
const svAiBlockRefSchema = z.object({ id: z.string(), type: z.string(), name: z.string() })
const svAiPatchSummarySchema = z.object({
  added: z.array(svAiBlockRefSchema),
  changed: z.array(svAiBlockRefSchema),
  removed: z.array(svAiBlockRefSchema),
  edgesAdded: z.number(),
})

export const svAiProposalSchema = z.object({
  // untyped-response: WorkflowPatch v1 ops, validated by the ai-assistant against the contract
  patch: z.record(z.string(), z.unknown()),
  graph: svAiGraphSchema,
  diagnostics: z.array(svDiagnosticSchema),
  summary: svAiPatchSummarySchema,
  valid: z.boolean(),
})

/** SSE events of a turn (`event:` name + JSON `data:`). */
export const svAiEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('text'), data: z.object({ delta: z.string() }) }),
  z.object({
    event: z.literal('tool'),
    data: z.object({ id: z.string(), name: z.string(), input: z.unknown() }),
  }),
  z.object({
    event: z.literal('tool_result'),
    data: z.object({ id: z.string(), name: z.string(), isError: z.boolean(), text: z.string() }),
  }),
  z.object({ event: z.literal('proposal'), data: svAiProposalSchema }),
  z.object({ event: z.literal('pending_action'), data: svAiPendingActionSchema }),
  z.object({ event: z.literal('error'), data: z.object({ message: z.string() }) }),
  z.object({
    event: z.literal('done'),
    data: z.object({ conversationId: z.string(), pending: z.boolean(), steps: z.number() }),
  }),
])

export type SvAiStatus = z.output<typeof svAiStatusSchema>
export type SvAiChatBody = z.input<typeof svAiChatBodySchema>
export type SvAiActionBody = z.input<typeof svAiActionBodySchema>
export type SvAiConversation = z.output<typeof svAiConversationSchema>
export type SvAiConversationSummary = z.output<typeof svAiConversationSummarySchema>
export type SvAiPendingAction = z.output<typeof svAiPendingActionSchema>
export type SvAiProposal = z.output<typeof svAiProposalSchema>
export type SvAiEvent = z.output<typeof svAiEventSchema>
