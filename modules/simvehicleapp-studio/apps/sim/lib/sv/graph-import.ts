import type { BlockState, Loop, Parallel } from '@sim/workflow-types/workflow'
import type { SimEdge } from '@/lib/sv/graph-adapter'
import { SV_VEHICLE_BLOCKS } from '@/blocks/vehicle'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * WorkflowGraph v1 → Sim editor state (M09-T08): the inverse of `adaptWorkflow`, so a workflow
 * exported with a project (`.simvehicleapp/workflows/*.graph.json`) imports back into the studio and
 * adapts to the same graph (round-trip, tested on the seven goldens). The graph has no canvas
 * positions: blocks are laid out in columns by their distance from the triggers.
 */

interface GraphBlockIn {
  id: string
  type: string
  name: string
  props?: Record<string, unknown>
  parentId?: string | null
}

export interface WorkflowGraphIn {
  graphVersion: string
  workflowId?: string
  name?: string
  vss?: { release?: string }
  variables?: { name: string; type: string; initial: unknown }[]
  blocks: GraphBlockIn[]
  edges: { id: string; from: string; fromHandle?: string; to: string; toHandle?: string }[]
}

export interface ImportedSimState {
  name: string
  vssRelease?: string
  blocks: Record<string, BlockState>
  edges: (SimEdge & { type: string; data: Record<string, unknown> })[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  variables: {
    id: string
    name: string
    type: 'string' | 'number' | 'boolean' | 'object' | 'array'
    value: unknown
  }[]
}

interface SpecProp {
  name: string
  kind: string
  items?: { name: string }[]
}
const SPECS = new Map(
  (specsSnapshot as { blocks: { type: string; props: SpecProp[] }[] }).blocks.map((s) => [
    s.type,
    s.props,
  ])
)
const CONTAINERS = new Set(['sv_repeat', 'sv_while', 'sv_parallel'])

const COLUMN = 320
const ROW = 140
const MARGIN = 40

/** A WorkflowGraph v1 document (as opposed to Sim's own workflow export). */
export function isWorkflowGraph(v: unknown): v is WorkflowGraphIn {
  const g = v as Partial<WorkflowGraphIn> | null
  return Boolean(
    g &&
      typeof g === 'object' &&
      typeof g.graphVersion === 'string' &&
      Array.isArray(g.blocks) &&
      Array.isArray(g.edges)
  )
}

/** Prop value as the editor stores it (inverse of the adapter's `propValue`). */
function subBlockValue(prop: SpecProp | undefined, value: unknown): unknown {
  if (!prop) return value
  // Dropdowns store their ids as strings (e.g. MQTT QoS 0 ⇒ "0").
  if (prop.kind === 'enum' && (typeof value === 'number' || typeof value === 'boolean'))
    return String(value)
  if (prop.kind === 'list' && Array.isArray(value)) {
    return value.map((row, i) => ({
      id: `row-${i + 1}`,
      cells: { ...(row as Record<string, unknown>) },
    }))
  }
  return value
}

function simVariable(
  v: { name: string; type: string; initial: unknown },
  i: number
): ImportedSimState['variables'][number] {
  const id = `var-${i + 1}`
  switch (v.type) {
    case 'double':
    case 'float':
    case 'int32':
    case 'int64':
      return {
        id,
        name: v.name,
        type: 'number',
        value: typeof v.initial === 'string' ? Number(v.initial) : v.initial,
      }
    case 'boolean':
      return { id, name: v.name, type: 'boolean', value: v.initial === true }
    case 'json':
      return {
        id,
        name: v.name,
        type: Array.isArray(v.initial) ? 'array' : 'object',
        value: v.initial ?? null,
      }
    default:
      return {
        id,
        name: v.name,
        type: 'string',
        value: v.initial === null || v.initial === undefined ? '' : String(v.initial),
      }
  }
}

/** Column of each block: longest distance from a block without incoming edges (cycles stop). */
function columns(ids: string[], edges: WorkflowGraphIn['edges']): Map<string, number> {
  const set = new Set(ids)
  const incoming = new Map(ids.map((id) => [id, 0]))
  for (const e of edges)
    if (set.has(e.from) && set.has(e.to)) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1)
  const col = new Map<string, number>()
  const queue = ids.filter((id) => incoming.get(id) === 0)
  for (const id of queue) col.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const e of edges) {
      if (e.from !== id || !set.has(e.to)) continue
      const next = (col.get(id) ?? 0) + 1
      if ((col.get(e.to) ?? -1) < next && next <= ids.length) {
        col.set(e.to, next)
        queue.push(e.to)
      }
    }
  }
  for (const id of ids) if (!col.has(id)) col.set(id, 0)
  return col
}

/** Positions of a set of sibling blocks: columns by distance, rows in graph order. */
function layout(
  ids: string[],
  edges: WorkflowGraphIn['edges']
): Map<string, { x: number; y: number }> {
  const col = columns(ids, edges)
  const rows = new Map<number, number>()
  const out = new Map<string, { x: number; y: number }>()
  for (const id of ids) {
    const c = col.get(id) ?? 0
    const r = rows.get(c) ?? 0
    rows.set(c, r + 1)
    out.set(id, { x: MARGIN + c * COLUMN, y: MARGIN + r * ROW })
  }
  return out
}

export function graphToSimState(graph: WorkflowGraphIn): ImportedSimState {
  const blocks: Record<string, BlockState> = {}
  const loops: Record<string, Loop> = {}
  const parallels: Record<string, Parallel> = {}
  const childrenOf = new Map<string | null, string[]>()
  for (const b of graph.blocks) {
    const parent = b.parentId ?? null
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), b.id])
  }
  const positions = new Map<string, { x: number; y: number }>()
  const sizes = new Map<string, { width: number; height: number }>()
  // Children are placed inside their container, which is sized to hold them.
  for (const [parent, ids] of childrenOf) {
    const placed = layout(ids, graph.edges)
    for (const [id, p] of placed) positions.set(id, parent ? { x: p.x + 60, y: p.y + 40 } : p)
    if (parent) {
      const maxX = Math.max(...[...placed.values()].map((p) => p.x))
      const maxY = Math.max(...[...placed.values()].map((p) => p.y))
      sizes.set(parent, { width: maxX + COLUMN + 60, height: maxY + ROW + 60 })
    }
  }
  // A container takes the room of its content in its own column layout.
  const shift = new Map<string, number>()
  for (const b of graph.blocks) {
    if (!CONTAINERS.has(b.type) || b.parentId) continue
    const size = sizes.get(b.id)
    if (size) shift.set(b.id, size.width - COLUMN)
  }

  for (const b of graph.blocks) {
    const position = positions.get(b.id) ?? { x: MARGIN, y: MARGIN }
    const parentData = b.parentId ? { parentId: b.parentId, extent: 'parent' as const } : {}
    const base = {
      id: b.id,
      name: b.name,
      position,
      enabled: true,
      horizontalHandles: true,
      advancedMode: false,
      triggerMode: false,
      height: 0,
      outputs: {},
      locked: false,
    }
    if (CONTAINERS.has(b.type)) {
      const nodes = childrenOf.get(b.id) ?? []
      const size = sizes.get(b.id) ?? { width: 500, height: 300 }
      const props = b.props ?? {}
      if (b.type === 'sv_parallel') {
        blocks[b.id] = {
          ...base,
          type: 'parallel',
          subBlocks: {},
          data: {
            ...parentData,
            type: 'subflowNode',
            ...size,
            count: Math.max(1, nodes.length),
            collection: '',
            parallelType: 'count',
            batchSize: 20,
          },
        } as BlockState
        parallels[b.id] = {
          id: b.id,
          nodes,
          count: Math.max(1, nodes.length),
          distribution: '',
          parallelType: 'count',
          batchSize: 20,
          enabled: true,
        }
      } else {
        const loop: Loop =
          b.type === 'sv_repeat'
            ? {
                id: b.id,
                nodes,
                iterations: Number(props.count ?? 1),
                loopType: 'for',
                forEachItems: '',
                enabled: true,
              }
            : {
                id: b.id,
                nodes,
                iterations: Number(props.maxIterations ?? 1000),
                loopType: 'while',
                whileCondition: String(props.condition ?? ''),
                enabled: true,
              }
        blocks[b.id] = {
          ...base,
          type: 'loop',
          subBlocks: {},
          data: {
            ...parentData,
            type: 'subflowNode',
            ...size,
            loopType: loop.loopType,
            count: loop.iterations,
            ...(loop.whileCondition ? { whileCondition: loop.whileCondition } : {}),
          },
        } as BlockState
        loops[b.id] = loop
      }
      continue
    }
    const config = SV_VEHICLE_BLOCKS[b.type]
    const specProps = SPECS.get(b.type) ?? []
    const subBlocks: BlockState['subBlocks'] = {}
    for (const sb of config?.subBlocks ?? []) {
      const prop = specProps.find((p) => p.name === sb.id)
      const value = b.props && sb.id in b.props ? subBlockValue(prop, b.props[sb.id]) : null
      subBlocks[sb.id] = { id: sb.id, type: sb.type, value } as BlockState['subBlocks'][string]
    }
    blocks[b.id] = { ...base, type: b.type, subBlocks, data: { ...parentData } } as BlockState
  }
  // Top-level blocks after a wide container move right so they do not overlap it.
  for (const [containerId, extra] of shift) {
    const cx = blocks[containerId].position.x
    for (const b of Object.values(blocks)) {
      if (!b.data?.parentId && b.position.x > cx)
        b.position = { ...b.position, x: b.position.x + extra }
    }
  }

  return {
    name: graph.name || 'Imported workflow',
    ...(graph.vss?.release ? { vssRelease: graph.vss.release } : {}),
    blocks,
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      sourceHandle: e.fromHandle ?? 'source',
      targetHandle: e.toHandle ?? 'target',
      type: 'default',
      data: {},
    })),
    loops,
    parallels,
    variables: (graph.variables ?? []).map(simVariable),
  }
}
