/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { describe, expect, it } from 'vitest'
import { adaptWorkflow, type WorkflowGraphOut } from '@/lib/sv/graph-adapter'
import { graphToSimState } from '@/lib/sv/graph-import'
import { proposalToWorkflowState, staleProposalBlocks } from '@/lib/sv/proposal-state'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * M10-T08: a proposal (WorkflowGraph after the patch) shown on the canvas adapts back to exactly
 * the proposed graph, keeps what the graph does not carry and the layout of existing blocks, and
 * gives added blocks fresh ids placed right of the block leading to them.
 */
const GOLDEN = fileURLToPath(new URL('./__golden__/', import.meta.url))
const gwA = JSON.parse(readFileSync(`${GOLDEN}GW-A/graph.json`, 'utf8')) as WorkflowGraphOut

const SPECS = new Map(
  (
    specsSnapshot as {
      blocks: { type: string; props: { name: string; kind: string; default?: unknown }[] }[]
    }
  ).blocks.map((s) => [s.type, s.props])
)

/** Props as the compiler reads them: absent/null = BlockSpec default (graph-import test). */
function filled(type: string, props: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const p of SPECS.get(type) ?? []) {
    let v = props[p.name] ?? p.default
    if (v === undefined) continue
    if (p.kind === 'expression' && typeof v !== 'string') v = String(v)
    out[p.name] = v
  }
  return out
}

function canvasOf(graph: WorkflowGraphOut): WorkflowState {
  const s = graphToSimState(graph)
  return { blocks: s.blocks, edges: s.edges, loops: s.loops, parallels: s.parallels }
}

function adapt(state: WorkflowState) {
  return adaptWorkflow({
    workflowId: gwA.workflowId,
    name: gwA.name,
    vssRelease: gwA.vss.release,
    state,
    variables: [],
  }).graph
}

function ids() {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

describe('proposal on the canvas (M10-T08)', () => {
  it('adds a block after the last one: adapts back to the proposal, existing layout kept', () => {
    const current = canvasOf(gwA)
    // A note on the canvas (not part of the graph) and a disabled vehicle block stay as they are.
    current.blocks.note = {
      ...structuredClone(Object.values(current.blocks)[0]),
      id: 'note',
      type: 'note',
      name: 'Note',
    } as BlockState
    const last = gwA.blocks[gwA.blocks.length - 1]
    const proposal: WorkflowGraphOut = {
      ...structuredClone(gwA),
      blocks: [
        ...gwA.blocks,
        {
          id: 'log1',
          type: 'sv_log',
          name: 'Log hazard',
          props: { level: 'info', message: 'hazard on' },
          parentId: null,
          blockVersion: 1,
        },
      ],
      edges: [
        ...gwA.edges,
        { id: 'e9', from: last.id, fromHandle: 'source', to: 'log1', toHandle: 'target' },
      ],
    }
    const state = proposalToWorkflowState(current, proposal, ids())

    const added = Object.values(state.blocks).find((b) => b.name === 'Log hazard')!
    expect(added.id).toBe('00000000-0000-4000-8000-000000000001')
    expect(added.position.x).toBeGreaterThan(state.blocks[last.id].position.x)
    expect(added.position.y).toBe(state.blocks[last.id].position.y)
    for (const b of gwA.blocks)
      expect(state.blocks[b.id].position).toEqual(current.blocks[b.id].position)
    expect(state.blocks.note).toEqual(current.blocks.note)

    const back = adapt(state)
    const named = (g: WorkflowGraphOut) => {
      const nameOf = new Map(g.blocks.map((b) => [b.id, b.name]))
      return {
        blocks: g.blocks
          .map((b) => [b.name, b.type, JSON.stringify(filled(b.type, b.props))].join(' '))
          .sort(),
        edges: g.edges
          .map((e) => [nameOf.get(e.from), e.fromHandle, nameOf.get(e.to), e.toHandle].join(' '))
          .sort(),
      }
    }
    expect(named(back)).toEqual(named(proposal))
    // Unchanged edges keep their ids (the diff view shows them as unchanged).
    for (const e of gwA.edges) expect(state.edges.some((x) => x.id === e.id)).toBe(true)
  })

  it('removes and changes blocks; set_props only touches the props it names', () => {
    const current = canvasOf(gwA)
    const [first, second, ...rest] = gwA.blocks
    const changed = { ...second, name: 'Renamed', props: { ...second.props } }
    const proposal: WorkflowGraphOut = {
      ...structuredClone(gwA),
      blocks: [first, changed, ...rest.slice(0, -1)],
      edges: gwA.edges.filter(
        (e) => e.to !== rest[rest.length - 1].id && e.from !== rest[rest.length - 1].id
      ),
    }
    const state = proposalToWorkflowState(current, proposal, ids())
    expect(state.blocks[rest[rest.length - 1].id]).toBeUndefined()
    expect(state.blocks[second.id].name).toBe('Renamed')
    expect(state.blocks[second.id].subBlocks).toEqual(current.blocks[second.id].subBlocks)
    expect(state.edges.every((e) => state.blocks[e.source] && state.blocks[e.target])).toBe(true)
    expect(
      adapt(state)
        .blocks.map((b) => b.name)
        .sort()
    ).toEqual(proposal.blocks.map((b) => b.name).sort())
  })
})

describe('stale proposals (M15 E2E: a turn sent before the canvas loaded)', () => {
  const current = canvasOf(gwA)
  const names = gwA.blocks.map((b) => b.name).sort()

  it('a proposal made on an empty graph would drop every block: all are reported', () => {
    const onEmpty = { ...gwA, blocks: [], edges: [] }
    expect(staleProposalBlocks(current, onEmpty, [])).toEqual(names)
  })

  it('a proposal on the current graph, or removing blocks on purpose, is not stale', () => {
    expect(staleProposalBlocks(current, gwA, [])).toEqual([])
    const [first, ...rest] = gwA.blocks
    const removing = {
      ...gwA,
      blocks: rest,
      edges: gwA.edges.filter((e) => e.from !== first!.id && e.to !== first!.id),
    }
    expect(staleProposalBlocks(current, removing, [first!.id])).toEqual([])
    expect(staleProposalBlocks(current, removing, [])).toEqual([first!.name])
  })
})
