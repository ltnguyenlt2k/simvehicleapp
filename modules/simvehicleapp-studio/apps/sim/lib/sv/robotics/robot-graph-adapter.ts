import type { RfProp } from '@/blocks/robot'
import { RF_BLOCK_SPECS, RF_CATALOG_HASH, RF_PROFILE, rfId } from '@/blocks/robot'

/**
 * Sim editor state → RobotFlow `robotflow.v1` (ADR-0068 §3). Pure and deterministic: nodes and edges are
 * sorted by id, block ids and port names are kept, values are typed from the registry snapshot. The browser
 * never compiles or runs robot behaviour; the robotics compiler does (BFF `/api/sv/robotics/*`).
 */

/** A block of the Sim canvas as needed by the adapter (`subBlocks[].value` already merged). */
export interface RobotCanvasBlock {
  id: string
  type: string
  name: string
  enabled?: boolean
  subBlocks?: Record<string, { value?: unknown } | undefined>
}

export interface RobotCanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export interface RobotFlowNode {
  id: string
  block: string
  label: string
  props: Record<string, string | number | boolean>
}

export interface RobotFlowDocument {
  schema: 'robotflow.v1'
  rss: { version: '0.1'; catalogHash: string }
  profile: string
  source: { workflowId: string; name: string }
  nodes: RobotFlowNode[]
  edges: { from: [string, string]; to: [string, 'in'] }[]
}

export interface RobotAdapterIssue {
  code: 'RF1001' | 'RF1005'
  message: string
  blockId?: string
}

const SPECS = new Map(RF_BLOCK_SPECS.map((spec) => [spec.id, spec]))
const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** True when the canvas holds robot-domain blocks (the workflow is a robot workflow). */
export function isRobotWorkflow(blocks: Record<string, { type: string }> | undefined): boolean {
  return Object.values(blocks ?? {}).some((block) => block.type.startsWith('rf_'))
}

function typed(prop: RfProp, raw: unknown): string | number | boolean | undefined {
  if (raw === undefined || raw === null) return undefined
  if (prop.type === 'boolean') return raw === true || raw === 'true'
  const text = typeof raw === 'string' ? raw.trim() : String(raw)
  if (prop.type === 'duration' || prop.type === 'integer' || prop.type === 'number') {
    if (text === '') return ''
    const value = Number(text.replace(',', '.'))
    return Number.isFinite(value) ? value : text
  }
  return text
}

export function adaptRobotWorkflow(input: {
  workflowId: string
  name: string
  blocks: Record<string, RobotCanvasBlock>
  edges: RobotCanvasEdge[]
}): { workflow: RobotFlowDocument; issues: RobotAdapterIssue[] } {
  const issues: RobotAdapterIssue[] = []
  const nodes: RobotFlowNode[] = []
  for (const block of Object.values(input.blocks).sort(byId)) {
    if (block.enabled === false || block.type === 'note') continue
    if (block.type.startsWith('sv_')) {
      issues.push({
        code: 'RF1001',
        blockId: block.id,
        message: 'Vehicle blocks cannot be mixed into a robot workflow',
      })
      continue
    }
    const spec = SPECS.get(rfId(block.type))
    if (!spec) continue
    const props: Record<string, string | number | boolean> = {}
    for (const prop of spec.props) {
      const value = typed(prop, block.subBlocks?.[prop.name]?.value)
      if (value !== undefined) props[prop.name] = value
    }
    nodes.push({ id: block.id, block: spec.id, label: block.name.slice(0, 96), props })
  }
  const kept = new Set(nodes.map((n) => n.id))
  const edges: RobotFlowDocument['edges'] = []
  for (const edge of [...input.edges].sort(byId)) {
    if (!kept.has(edge.source) || !kept.has(edge.target)) continue
    if (!edge.sourceHandle) {
      issues.push({
        code: 'RF1005',
        blockId: edge.source,
        message: 'Link from an unnamed output; reconnect it',
      })
      continue
    }
    edges.push({ from: [edge.source, edge.sourceHandle], to: [edge.target, 'in'] })
  }
  return {
    workflow: {
      schema: 'robotflow.v1',
      rss: { version: '0.1', catalogHash: RF_CATALOG_HASH },
      profile: RF_PROFILE,
      source: { workflowId: input.workflowId, name: input.name.slice(0, 200) || 'Untitled' },
      nodes,
      edges,
    },
    issues,
  }
}
