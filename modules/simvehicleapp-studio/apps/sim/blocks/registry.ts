import { stripVersionSuffix } from '@sim/utils/string'
import { A2ABlock } from '@/blocks/blocks/a2a'
import { AgentBlock } from '@/blocks/blocks/agent'
import { ApiBlock } from '@/blocks/blocks/api'
import { ApiTriggerBlock } from '@/blocks/blocks/api_trigger'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { CirclebackBlock, CirclebackBlockMeta } from '@/blocks/blocks/circleback'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { DeploymentsBlock } from '@/blocks/blocks/deployments'
import { EnrichmentBlock, EnrichmentBlockMeta } from '@/blocks/blocks/enrichment'
import { EvaluatorBlock } from '@/blocks/blocks/evaluator'
import { FileBlock, FileV2Block, FileV3Block, FileV4Block, FileV5Block } from '@/blocks/blocks/file'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GuardrailsBlock } from '@/blocks/blocks/guardrails'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { ImageGeneratorBlock, ImageGeneratorV2Block } from '@/blocks/blocks/image_generator'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'
import { LogsBlock, LogsV2Block } from '@/blocks/blocks/logs'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { MemoryBlock } from '@/blocks/blocks/memory'
// SV: mothership block removed (proprietary copilot backend, M01-T03)
import { NoteBlock } from '@/blocks/blocks/note'
import { PiBlock } from '@/blocks/blocks/pi'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { RssBlock, RssBlockMeta } from '@/blocks/blocks/rss'
import { ScheduleBlock } from '@/blocks/blocks/schedule'
import { SearchBlock } from '@/blocks/blocks/search'
import { SimWorkspaceEventBlock } from '@/blocks/blocks/sim_workspace_event'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { StarterBlock } from '@/blocks/blocks/starter'
import { TableBlock } from '@/blocks/blocks/table'
import { ThinkingBlock } from '@/blocks/blocks/thinking'
import { TranslateBlock } from '@/blocks/blocks/translate'
import { TtsBlock } from '@/blocks/blocks/tts'
import { VariablesBlock } from '@/blocks/blocks/variables'
import {
  VideoGeneratorBlock,
  VideoGeneratorV2Block,
  VideoGeneratorV3Block,
} from '@/blocks/blocks/video_generator'
import { VisionBlock, VisionV2Block } from '@/blocks/blocks/vision'
import { WaitBlock } from '@/blocks/blocks/wait'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import type {
  BlockCategory,
  BlockConfig,
  BlockMeta,
  BlockTemplate,
  SuggestedSkill,
} from '@/blocks/types'
// SV: SimVehicleApp vehicle blocks (ADR-0011 §3)
import { SV_VEHICLE_BLOCKS } from '@/blocks/vehicle'

/** All block configs keyed by block type. The execution source of truth. */
const BLOCK_REGISTRY: Record<string, BlockConfig> = {
  a2a: A2ABlock,
  agent: AgentBlock,
  api: ApiBlock,
  api_trigger: ApiTriggerBlock,
  chat_trigger: ChatTriggerBlock,
  circleback: CirclebackBlock,
  condition: ConditionBlock,
  credential: CredentialBlock,
  deployments: DeploymentsBlock,
  enrichment: EnrichmentBlock,
  evaluator: EvaluatorBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  file_v4: FileV4Block,
  file_v5: FileV5Block,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  guardrails: GuardrailsBlock,
  human_in_the_loop: HumanInTheLoopBlock,
  image_generator: ImageGeneratorBlock,
  image_generator_v2: ImageGeneratorV2Block,
  input_trigger: InputTriggerBlock,
  knowledge: KnowledgeBlock,
  logs: LogsBlock,
  logs_v2: LogsV2Block,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  memory: MemoryBlock,
  note: NoteBlock,
  pi: PiBlock,
  response: ResponseBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  rss: RssBlock,
  schedule: ScheduleBlock,
  search: SearchBlock,
  sim_workspace_event: SimWorkspaceEventBlock,
  start_trigger: StartTriggerBlock,
  starter: StarterBlock,
  table: TableBlock,
  thinking: ThinkingBlock,
  translate: TranslateBlock,
  tts: TtsBlock,
  variables: VariablesBlock,
  video_generator: VideoGeneratorBlock,
  video_generator_v2: VideoGeneratorV2Block,
  video_generator_v3: VideoGeneratorV3Block,
  vision: VisionBlock,
  vision_v2: VisionV2Block,
  wait: WaitBlock,
  webhook_request: WebhookRequestBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
  // SV: SimVehicleApp vehicle blocks (ADR-0011 §3)
  ...SV_VEHICLE_BLOCKS,
}

/**
 * Block presentation/catalog metas (`{ tags, templates }`) keyed by block
 * type. Sibling to `BLOCK_REGISTRY`; pulled from the same block files so the
 * two stay in lockstep without a separate registry to maintain.
 *
 * `BlockMeta` exists only for catalog-visible integrations — every key here
 * has a corresponding entry in `lib/integrations/integrations.json`. Blocks
 * absent from the catalog (core blocks like `agent`/`api`, superseded base
 * versions, and hidden tools) carry no meta because the only consumers are
 * integration surfaces: `getTemplatesForBlock` (the two integration detail
 * pages) and `getAllBlockMeta()` → `POPULAR_WORKFLOWS` (landing integrations
 * index). The toolbar and search modal read block *configs*, not metas.
 */
const BLOCK_META_REGISTRY: Record<string, BlockMeta> = {
  circleback: CirclebackBlockMeta,
  enrichment: EnrichmentBlockMeta,
  rss: RssBlockMeta,
}

/**
 * Normalize an external block type to its registry key form: dashes become
 * underscores (some external sources use either form).
 */
function normalizeType(type: string): string {
  return type.replace(/-/g, '_')
}

/** Get the block config for a single block type. */
export function getBlock(type: string): BlockConfig | undefined {
  return BLOCK_REGISTRY[type] ?? BLOCK_REGISTRY[normalizeType(type)]
}

/** All block configs. */
export function getAllBlocks(): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY)
}

/** Find the block whose `tools.access` contains the given tool id. */
export function getBlockByToolName(toolName: string): BlockConfig | undefined {
  return Object.values(BLOCK_REGISTRY).find((b) => b.tools?.access?.includes(toolName))
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation. Returns the registry key alongside the
 * config so callers that need the canonical type identifier avoid re-deriving
 * it.
 */
function resolveLatest(baseType: string): { type: string; config: BlockConfig } | undefined {
  const normalized = normalizeType(baseType)
  const versionPattern = new RegExp(`^${normalized}_v(\\d+)$`)
  let latestKey: string | undefined
  let latestVersion = -1
  for (const key of Object.keys(BLOCK_REGISTRY)) {
    const match = key.match(versionPattern)
    if (!match) continue
    const version = Number.parseInt(match[1]!, 10)
    if (version > latestVersion) {
      latestVersion = version
      latestKey = key
    }
  }
  if (latestKey) return { type: latestKey, config: BLOCK_REGISTRY[latestKey]! }
  const config = BLOCK_REGISTRY[normalized]
  return config ? { type: normalized, config } : undefined
}

/**
 * Resolve the canonical (highest-version) block for a base type. Handles
 * versioned variants like `confluence_v2`: callers pass `confluence` and
 * receive the latest implementation.
 */
export function getLatestBlock(baseType: string): BlockConfig | undefined {
  return resolveLatest(baseType)?.config
}

/** All blocks in a given category. */
export function getBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter((block) => block.category === category)
}

/**
 * The canonical "latest-version, toolbar-visible" set of blocks for a
 * category. This is the single source of truth shared by every surface that
 * extracts blocks for presentation — the toolbar, the search/mention engine,
 * and the integrations catalog. A block is included when its `category`
 * matches and it is not hidden from the toolbar (i.e. it is the latest
 * version under the upgrade paradigm, since superseded versions set
 * `hideFromToolbar: true`).
 */
export function getCanonicalBlocksByCategory(category: BlockCategory): BlockConfig[] {
  return Object.values(BLOCK_REGISTRY).filter(
    (block) => block.category === category && !block.hideFromToolbar
  )
}

/** All registered block type identifiers. */
export function getAllBlockTypes(): string[] {
  return Object.keys(BLOCK_REGISTRY)
}

/** Whether the given string is a registered block type. Accepts hyphens as a dash-form alias. */
export function isValidBlockType(type: string): type is string {
  return type in BLOCK_REGISTRY || normalizeType(type) in BLOCK_REGISTRY
}

/**
 * Get the presentation/catalog meta for a block type, resolving through the
 * version suffix the same way {@link getTemplatesForBlock} does. Metas are
 * keyed under the base type (e.g. `confluence`, not `confluence_v2`), so a
 * versioned lookup falls back to the stripped base.
 */
export function getBlockMeta(type: string): BlockMeta | undefined {
  const normalized = normalizeType(type)
  return (
    BLOCK_META_REGISTRY[type] ??
    BLOCK_META_REGISTRY[normalized] ??
    BLOCK_META_REGISTRY[stripVersionSuffix(normalized)]
  )
}

/** All block metas keyed by block type. */
export function getAllBlockMeta(): Record<string, BlockMeta> {
  return BLOCK_META_REGISTRY
}

/**
 * A template scoped to a viewing block, enriched with `otherBlockTypes` —
 * the integrations to render alongside the viewer in the icon cluster.
 * Includes the template's owner block whenever the viewer is not the owner.
 */
export interface ScopedBlockTemplate extends BlockTemplate {
  /** Block types (base form) to render alongside the viewing block in the icon cluster. */
  otherBlockTypes: readonly string[]
}

/**
 * All templates whose owner block is `type` or which list `type` in their
 * `alsoIntegrations`. Each returned template carries `otherBlockTypes` —
 * the non-viewing integrations (owner + other alsoIntegrations) for icon
 * cluster rendering.
 */
export function getTemplatesForBlock(type: string): ScopedBlockTemplate[] {
  const base = stripVersionSuffix(type)
  const collected: ScopedBlockTemplate[] = []
  for (const [ownerType, meta] of Object.entries(BLOCK_META_REGISTRY)) {
    if (!meta.templates) continue
    const ownerBase = stripVersionSuffix(ownerType)
    const isOwnerMatch = ownerBase === base
    for (const template of meta.templates) {
      const isAlsoMatch =
        template.alsoIntegrations?.includes(base) || template.alsoIntegrations?.includes(type)
      if (!isOwnerMatch && !isAlsoMatch) continue
      const others: string[] = []
      if (!isOwnerMatch) others.push(ownerBase)
      for (const also of template.alsoIntegrations ?? []) {
        const alsoBase = stripVersionSuffix(also)
        if (alsoBase !== base && !others.includes(alsoBase)) others.push(alsoBase)
      }
      collected.push({ ...template, otherBlockTypes: others })
    }
  }
  return collected
}

/**
 * Popular, ready-to-add skills for a block type. Curated skills live on the
 * base integration's meta, but a versioned catalog type (e.g. `notion_v2`) has
 * its own meta entry that {@link getBlockMeta} resolves first and which may omit
 * skills — so fall back to the stripped base meta. Returns an empty array when
 * the integration has no curated skills.
 */
export function getSuggestedSkillsForBlock(type: string): readonly SuggestedSkill[] {
  const direct = getBlockMeta(type)?.skills
  if (direct && direct.length > 0) return direct
  const base = stripVersionSuffix(normalizeType(type))
  return BLOCK_META_REGISTRY[base]?.skills ?? []
}

/**
 * Raw block registry map keyed by block type. Prefer the typed accessors
 * (`getBlock`, `getAllBlocks`, `getCanonicalBlocksByCategory`); this alias is
 * retained for callers that need the underlying record directly.
 */
export const registry: Record<string, BlockConfig> = BLOCK_REGISTRY

export type { BlockCategory }
