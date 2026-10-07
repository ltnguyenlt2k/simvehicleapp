import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import type { Edge } from 'reactflow'
import { graphToSimState, type WorkflowGraphIn } from '@/lib/sv/graph-import'

/**
 * Canvas state of an assistant proposal (M10-T08): the proposed WorkflowGraph v1 applied onto the
 * current editor state, so the diff view shows exactly what the patch changes. Blocks the graph does
 * not carry (Sim blocks, notes, disabled blocks) and the layout of existing blocks are kept; blocks
 * the patch added get fresh ids (the assistant's refs are only unique within its draft — references
 * in expressions use names, not ids) and are placed right of the block that leads to them.
 */

const COLUMN = 320
const ROW = 140

/** Blocks the WorkflowGraph carries (`adaptWorkflow`): enabled vehicle blocks and containers. */
function inGraph(b: BlockState): boolean {
  return (
    b.enabled !== false && (b.type.startsWith('sv_') || b.type === 'loop' || b.type === 'parallel')
  )
}

/**
 * Names of current blocks a proposal would drop without removing them: the proposal was made on another
 * version of the workflow (e.g. sent before the canvas had loaded), so applying it would delete them.
 * `removed` = the block ids the patch removed on purpose (proposal `summary.removed`).
 */
export function staleProposalBlocks(
  current: WorkflowState,
  proposal: WorkflowGraphIn,
  removed: readonly string[]
): string[] {
  const kept = new Set([...proposal.blocks.map((b) => b.id), ...removed])
  return Object.values(current.blocks)
    .filter((b) => inGraph(b) && !kept.has(b.id))
    .map((b) => b.name)
    .sort()
}

export function proposalToWorkflowState(
  current: WorkflowState,
  proposal: WorkflowGraphIn,
  newId: () => string
): WorkflowState {
  const imported = graphToSimState(proposal)
  const owned = new Set(
    Object.values(current.blocks)
      .filter(inGraph)
      .map((b) => b.id)
  )
  const idOf = new Map<string, string>()
  for (const b of proposal.blocks) idOf.set(b.id, owned.has(b.id) ? b.id : newId())

  const blocks: Record<string, BlockState> = {}
  for (const [id, b] of Object.entries(current.blocks)) {
    if (!owned.has(id)) blocks[id] = structuredClone(b)
  }

  for (const gb of proposal.blocks) {
    const id = idOf.get(gb.id) as string
    const fresh = imported.blocks[gb.id]
    const parentId = gb.parentId ? idOf.get(gb.parentId) : undefined
    const existing = owned.has(gb.id) ? current.blocks[gb.id] : undefined
    if (existing) {
      const merged = structuredClone(existing)
      merged.name = fresh.name
      for (const [key, sub] of Object.entries(fresh.subBlocks ?? {})) {
        if (gb.props && key in gb.props) {
          merged.subBlocks[key] = { ...(merged.subBlocks[key] ?? sub), value: sub.value }
        }
      }
      blocks[id] = merged
      continue
    }
    const data = { ...(fresh.data ?? {}) }
    if (parentId) Object.assign(data, { parentId, extent: 'parent' })
    blocks[id] = { ...structuredClone(fresh), id, data }
  }

  // New top-level blocks: right of the block leading to them (placed first), else under the content.
  const fresh = proposal.blocks.filter((b) => !owned.has(b.id))
  const added = new Set(fresh.map((b) => idOf.get(b.id) as string))
  const placed = new Set(Object.keys(blocks).filter((id) => !added.has(id)))
  const perSource = new Map<string, number>()
  const topLevel = Object.values(blocks).filter((b) => !b.data?.parentId)
  let nextFreeY = topLevel.length
    ? Math.max(...topLevel.filter((b) => placed.has(b.id)).map((b) => b.position.y), 0) + ROW * 1.5
    : 40
  const leftmost = topLevel.filter((b) => placed.has(b.id)).length
    ? Math.min(...topLevel.filter((b) => placed.has(b.id)).map((b) => b.position.x))
    : 40
  for (let progress = true; progress; ) {
    progress = false
    for (const gb of fresh) {
      const id = idOf.get(gb.id) as string
      if (placed.has(id) || gb.parentId) continue
      const from = proposal.edges.find((e) => e.to === gb.id && placed.has(idOf.get(e.from) ?? ''))
      if (!from) continue
      const source = blocks[idOf.get(from.from) as string]
      const n = perSource.get(source.id) ?? 0
      perSource.set(source.id, n + 1)
      const width = Number((source.data as { width?: number } | undefined)?.width ?? 0)
      blocks[id].position = {
        x: source.position.x + Math.max(COLUMN, width + 60),
        y: source.position.y + n * ROW,
      }
      placed.add(id)
      progress = true
    }
  }
  for (const gb of fresh) {
    const id = idOf.get(gb.id) as string
    if (placed.has(id) || gb.parentId) continue
    blocks[id].position = { x: leftmost, y: nextFreeY }
    nextFreeY += ROW
    placed.add(id)
  }

  const currentEdges = new Map(current.edges.map((e) => [e.id, e]))
  const edges: Edge[] = current.edges
    .filter((e) => !(owned.has(e.source) && owned.has(e.target)))
    .filter((e) => blocks[e.source] && blocks[e.target])
    .map((e) => ({ ...e }))
  for (const e of imported.edges) {
    const source = idOf.get(e.source)
    const target = idOf.get(e.target)
    if (!source || !target) continue
    const before = currentEdges.get(e.id)
    const same = before && before.source === source && before.target === target
    edges.push({
      ...(same ? before : {}),
      id: same ? e.id : newId(),
      source,
      target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: before?.type ?? e.type,
    } as Edge)
  }

  const remap = (ids: string[]) => ids.map((n) => idOf.get(n) ?? n)
  const loops: WorkflowState['loops'] = {}
  for (const [id, loop] of Object.entries(current.loops ?? {})) {
    if (blocks[id] && !owned.has(id)) loops[id] = structuredClone(loop)
  }
  for (const [gid, loop] of Object.entries(imported.loops)) {
    const id = idOf.get(gid) as string
    const before = owned.has(gid) ? current.loops?.[gid] : undefined
    loops[id] = { ...(before ? structuredClone(before) : loop), id, nodes: remap(loop.nodes) }
  }
  const parallels: WorkflowState['parallels'] = {}
  for (const [id, parallel] of Object.entries(current.parallels ?? {})) {
    if (blocks[id] && !owned.has(id)) parallels[id] = structuredClone(parallel)
  }
  for (const [gid, parallel] of Object.entries(imported.parallels)) {
    const id = idOf.get(gid) as string
    const before = owned.has(gid) ? current.parallels?.[gid] : undefined
    parallels[id] = {
      ...(before ? structuredClone(before) : parallel),
      id,
      nodes: remap(parallel.nodes),
    }
  }

  return { ...current, blocks, edges, loops, parallels }
}
