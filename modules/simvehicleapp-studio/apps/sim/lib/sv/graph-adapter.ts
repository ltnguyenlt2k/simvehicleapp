import type { BlockState, Loop, Parallel, Variable } from '@sim/workflow-types/workflow'
import { mapSimContainer } from '@/lib/sv/container-mapping'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * Sim editor state → WorkflowGraph v1 (contracts `workflow-graph`, analysis/06 §1.1). Pure and
 * deterministic: same state ⇒ same graph bytes (blocks/edges sorted by id). Only SimVehicleApp
 * blocks (`sv_*`) and Sim's loop/parallel containers (→ `sv_repeat`/`sv_while`/`sv_parallel`,
 * M03-T10) are kept; other Sim blocks (Start, Note, …) and their edges are dropped.
 */

interface SpecProp {
  name: string
  kind: string
  enum?: (string | number | boolean)[]
  items?: { name: string }[]
}
interface Spec {
  type: string
  props: SpecProp[]
}
const SPECS = new Map((specsSnapshot as { blocks: Spec[] }).blocks.map((s) => [s.type, s]))

export interface SimEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface SimWorkflowState {
  blocks: Record<string, BlockState>
  edges: SimEdge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
}

export interface GraphBlockOut {
  id: string
  type: string
  name: string
  props: Record<string, unknown>
  parentId: string | null
  blockVersion: number
}

export interface WorkflowGraphOut {
  graphVersion: '1.0.0'
  workflowId: string
  revision: number
  name: string
  vss: { release: string }
  variables: { name: string; type: string; initial: unknown }[]
  blocks: GraphBlockOut[]
  edges: { id: string; from: string; fromHandle: string; to: string; toHandle: string }[]
}

/** Problems found while adapting (shown with lint results; codes from the public catalog). */
export interface AdapterIssue {
  code: 'CONTAINER_INVALID' | 'BLOCK_PROPERTY_INVALID'
  blockId?: string
  message: string
}

export interface AdaptInput {
  workflowId: string
  name: string
  vssRelease: string
  state: SimWorkflowState
  variables: Variable[]
}

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Sim variable types → SVX value types (ADR-0012 Notes M03-T09). */
function variableOf(v: Variable): { name: string; type: string; initial: unknown } {
  switch (v.type) {
    case 'number': {
      const n = typeof v.value === 'number' ? v.value : Number(v.value ?? 0)
      return { name: v.name, type: 'double', initial: Number.isFinite(n) ? n : 0 }
    }
    case 'boolean':
      return { name: v.name, type: 'boolean', initial: v.value === true || v.value === 'true' }
    case 'array':
    case 'object': {
      let initial: unknown = v.value ?? null
      if (typeof initial === 'string') {
        try {
          initial = JSON.parse(initial)
        } catch {
          initial = null
        }
      }
      return { name: v.name, type: 'json', initial }
    }
    default:
      return {
        name: v.name,
        type: 'string',
        initial: v.value === undefined || v.value === null ? '' : String(v.value),
      }
  }
}

/** One prop value from the subBlock store, shaped like the BlockSpec expects. */
function propValue(prop: SpecProp, raw: unknown): unknown {
  if (raw === undefined) return undefined
  if (prop.kind === 'enum' && prop.enum && typeof raw === 'string') {
    // Sim dropdowns store ids as strings; restore number/boolean enum members (e.g. MQTT QoS 0).
    return prop.enum.find((e) => String(e) === raw) ?? raw
  }
  if (prop.kind === 'list' && Array.isArray(raw)) {
    return raw.map((row) => {
      const cells = (row as { cells?: Record<string, unknown> })?.cells ?? {}
      return Object.fromEntries((prop.items ?? []).map((i) => [i.name, cells[i.name] ?? '']))
    })
  }
  return raw
}

export function adaptWorkflow(input: AdaptInput): {
  graph: WorkflowGraphOut
  issues: AdapterIssue[]
} {
  const issues: AdapterIssue[] = []
  const { blocks: simBlocks, edges: simEdges, loops, parallels } = input.state
  const kept = new Map<string, GraphBlockOut>()

  for (const b of Object.values(simBlocks).sort(byId)) {
    if (b.enabled === false) continue
    const parentId = b.data?.parentId ?? null
    if (b.type === 'loop' || b.type === 'parallel') {
      const cfg =
        b.type === 'loop'
          ? {
              type: 'loop' as const,
              loopType: loops[b.id]?.loopType ?? b.data?.loopType,
              iterations: loops[b.id]?.iterations ?? b.data?.count,
              whileCondition: loops[b.id]?.whileCondition ?? b.data?.whileCondition,
            }
          : {
              type: 'parallel' as const,
              parallelType: parallels[b.id]?.parallelType ?? b.data?.parallelType,
              count: parallels[b.id]?.count ?? b.data?.count,
            }
      const mapped = mapSimContainer(cfg)
      if ('code' in mapped) {
        issues.push({ code: 'CONTAINER_INVALID', blockId: b.id, message: mapped.message })
        continue
      }
      kept.set(b.id, {
        id: b.id,
        type: mapped.type,
        name: b.name,
        props: mapped.props,
        parentId,
        blockVersion: 1,
      })
      continue
    }
    const spec = SPECS.get(b.type)
    if (!spec) continue
    const props: Record<string, unknown> = {}
    for (const p of spec.props) {
      const v = propValue(p, b.subBlocks?.[p.name]?.value)
      if (v !== undefined) props[p.name] = v
    }
    kept.set(b.id, { id: b.id, type: b.type, name: b.name, props, parentId, blockVersion: 1 })
  }
  // Children of dropped containers lose their parent (lint then reports them as unreachable).
  for (const b of kept.values()) if (b.parentId && !kept.has(b.parentId)) b.parentId = null

  const edges = simEdges
    .filter((e) => kept.has(e.source) && kept.has(e.target))
    .map((e) => ({
      id: e.id,
      from: e.source,
      fromHandle: e.sourceHandle || 'source',
      to: e.target,
      toHandle: e.targetHandle || 'target',
    }))
    .sort(byId)

  const variables = []
  for (const v of [...input.variables].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!VARIABLE_NAME.test(v.name)) {
      issues.push({
        code: 'BLOCK_PROPERTY_INVALID',
        message: `Variable name '${v.name}' must use letters, digits and _ only`,
      })
      continue
    }
    variables.push(variableOf(v))
  }

  return {
    graph: {
      graphVersion: '1.0.0',
      workflowId: input.workflowId,
      revision: 0,
      name: input.name.slice(0, 200) || 'Untitled',
      vss: { release: input.vssRelease },
      variables,
      blocks: [...kept.values()],
      edges,
    },
    issues,
  }
}
