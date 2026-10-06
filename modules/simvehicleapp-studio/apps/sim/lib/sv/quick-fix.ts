import type { BlockState } from '@sim/workflow-types/workflow'
import { normalizeName } from '@/executor/constants'
import { getUniqueBlockName } from '@/stores/workflows/utils'

/**
 * Quick-fix for TYPE_NARROWING_REQUIRES_CAST (M04-T11, ADR-0015 §3): put a Convert block in front of
 * the block, move the expression into it (`to` = the target type from the diagnostic) and read
 * `<convertN.result>` instead. The Convert sits on every incoming connection, so whatever the
 * expression referenced still runs before it. Pure: the editor applies the plan with collaborative ops.
 */

export interface PlanEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ConvertFixPlan {
  block: {
    id: string
    type: 'sv_convert'
    name: string
    position: { x: number; y: number }
    parentId?: string
  }
  values: { value: string; to: string }
  removeEdgeIds: string[]
  addEdges: PlanEdge[]
  field: { blockId: string; subBlockId: string; value: string }
}

/** Horizontal gap left of the fixed block (one block width + spacing). */
const OFFSET_X = 320

export function planConvertFix(input: {
  blocks: Record<string, BlockState>
  edges: readonly PlanEdge[]
  blockId: string
  field: string
  /** Target type from the diagnostic `data.to` (e.g. `uint8`). */
  to: string
  /** Current expression of the field. */
  expression: string
  newBlockId: string
  newEdgeId: () => string
}): ConvertFixPlan | null {
  const target = input.blocks[input.blockId]
  if (!target || !input.expression.trim()) return null
  const name = getUniqueBlockName('Convert', input.blocks)
  const parentId = (target.data as { parentId?: string } | undefined)?.parentId
  const incoming = input.edges.filter(
    (e) => e.target === input.blockId && (e.targetHandle ?? 'target') === 'target'
  )
  return {
    block: {
      id: input.newBlockId,
      type: 'sv_convert',
      name,
      position: { x: target.position.x - OFFSET_X, y: target.position.y },
      ...(parentId ? { parentId } : {}),
    },
    values: { value: input.expression, to: input.to },
    removeEdgeIds: incoming.map((e) => e.id),
    addEdges: [
      ...incoming.map((e) => ({
        id: input.newEdgeId(),
        source: e.source,
        target: input.newBlockId,
        sourceHandle: e.sourceHandle ?? 'source',
        targetHandle: 'target',
      })),
      {
        id: input.newEdgeId(),
        source: input.newBlockId,
        target: input.blockId,
        sourceHandle: 'source',
        targetHandle: 'target',
      },
    ],
    field: {
      blockId: input.blockId,
      subBlockId: input.field,
      value: `<${normalizeName(name)}.result>`,
    },
  }
}
