import { svHandleTone } from '@/lib/sv/handle-labels'

/**
 * Lanes (ADR-0059 §3, M18-T08): Auto layout of a vehicle workflow — one row ("lane") per trigger, left to right in
 * the order the blocks run. A positive branch (then, stable, in time, case n) carries on along the row; the others
 * (else, broken, timeout, error…) go to a new row below. A block reached twice is placed once, at its furthest
 * column. Blocks inside a Loop/Parallel keep their place in it (positions there are relative to the container).
 * Deterministic: same blocks and edges ⇒ same positions.
 */

export interface LaneBlock {
  id: string
  type: string
  name: string
  position: { x: number; y: number }
  enabled?: boolean
  data?: { parentId?: string | null; width?: number; height?: number }
}

export interface LaneEdge {
  source: string
  sourceHandle?: string | null
  target: string
}

export interface LaneRegion {
  triggerId: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

export const LANE = {
  COLUMN: 330,
  ROW: 190,
  GAP: 80,
  ORIGIN_X: 120,
  ORIGIN_Y: 120,
  PAD: 30,
  TITLE: 26,
  BLOCK_WIDTH: 250,
  BLOCK_HEIGHT: 120,
} as const

const isTrigger = (b: LaneBlock) => b.type.startsWith('sv_on_')
const isForward = (h: string | null | undefined) =>
  !h || h === 'source' || h === 'next' || /-end-source$/.test(h)
const isInside = (h: string | null | undefined) => !!h && /-start-source$/.test(h)
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byPosition = (a: LaneBlock, b: LaneBlock) =>
  a.position.y - b.position.y || a.position.x - b.position.x || byId(a, b)

/** Branch order out of one block: forward, then positive branches, then the rest by handle name. */
function handleRank(h: string | null | undefined): number {
  if (isForward(h)) return 0
  const tone = svHandleTone(h)
  return tone === 'positive' ? 1 : 2
}

export function laneLayout(
  blocks: Record<string, LaneBlock>,
  edges: readonly LaneEdge[]
): Record<string, { x: number; y: number }> {
  const top = new Map(
    Object.values(blocks)
      .filter((b) => b.enabled !== false && !b.data?.parentId)
      .map((b) => [b.id, b])
  )
  const out = new Map<string, LaneEdge[]>()
  for (const e of edges) {
    if (!top.has(e.source) || !top.has(e.target) || isInside(e.sourceHandle)) continue
    out.set(e.source, [...(out.get(e.source) ?? []), e])
  }
  for (const list of out.values())
    list.sort(
      (a, b) =>
        handleRank(a.sourceHandle) - handleRank(b.sourceHandle) ||
        String(a.sourceHandle ?? '').localeCompare(String(b.sourceHandle ?? '')) ||
        byPosition(top.get(a.target) as LaneBlock, top.get(b.target) as LaneBlock)
    )

  // Column of every block: its longest path from a trigger (a join sits after both branches).
  const column = new Map<string, number>()
  const triggers = [...top.values()].filter(isTrigger).sort(byPosition)
  for (const t of triggers) {
    const depth = new Map<string, number>([[t.id, 0]])
    const queue = [t.id]
    let guard = 0
    while (queue.length && guard++ < 10_000) {
      const id = queue.shift() as string
      for (const e of out.get(id) ?? []) {
        const d = (depth.get(id) ?? 0) + 1
        if (d > top.size) continue // a cycle: stop growing
        if ((depth.get(e.target) ?? -1) < d) {
          depth.set(e.target, d)
          queue.push(e.target)
        }
      }
    }
    for (const [id, d] of depth) if (!column.has(id) || (column.get(id) ?? 0) < d) column.set(id, d)
  }

  // Rows: each lane starts below the previous one; a non-positive branch opens a new row in its lane.
  const row = new Map<string, number>()
  /** Lane of each row: lanes are drawn apart by a gap. */
  const laneOfRow = new Map<number, number>()
  let nextRow = 0
  let lane = 0
  for (const t of triggers) {
    if (row.has(t.id)) continue
    const laneStart = nextRow
    let laneRows = laneStart
    const place = (id: string, r: number) => {
      if (row.has(id)) return
      row.set(id, r)
      laneRows = Math.max(laneRows, r)
      let first = true
      for (const e of out.get(id) ?? []) {
        if (row.has(e.target)) continue
        const straight = first && handleRank(e.sourceHandle) < 2
        place(e.target, straight ? r : laneRows + 1)
        first = false
      }
    }
    place(t.id, laneStart)
    for (let r = laneStart; r <= laneRows; r++) laneOfRow.set(r, lane)
    lane++
    nextRow = laneRows + 1
  }
  // Blocks no trigger reaches: a last row each, in canvas order.
  for (const b of [...top.values()].sort(byPosition)) {
    if (row.has(b.id)) continue
    laneOfRow.set(nextRow, lane)
    row.set(b.id, nextRow++)
    column.set(b.id, 0)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  for (const b of [...top.values()].sort(byId)) {
    const r = row.get(b.id) ?? 0
    positions[b.id] = {
      x: LANE.ORIGIN_X + (column.get(b.id) ?? 0) * LANE.COLUMN,
      y: LANE.ORIGIN_Y + r * LANE.ROW + (laneOfRow.get(r) ?? 0) * LANE.GAP,
    }
  }
  return positions
}

/**
 * Background regions of the lanes: the box around each trigger's blocks, with the trigger's name. Empty when two
 * boxes overlap (a hand-made layout): regions only help when the lanes read apart.
 */
export function laneRegions(
  blocks: Record<string, LaneBlock>,
  edges: readonly LaneEdge[]
): LaneRegion[] {
  const top = new Map(
    Object.values(blocks)
      .filter((b) => b.enabled !== false && !b.data?.parentId)
      .map((b) => [b.id, b])
  )
  const out = new Map<string, string[]>()
  for (const e of edges) {
    if (!top.has(e.source) || !top.has(e.target)) continue
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
  }
  const triggers = [...top.values()].filter(isTrigger).sort(byPosition)
  if (triggers.length < 2) return []
  const regions: LaneRegion[] = []
  for (const t of triggers) {
    const seen = new Set([t.id])
    const queue = [t.id]
    while (queue.length) {
      for (const n of out.get(queue.shift() as string) ?? []) {
        if (seen.has(n)) continue
        seen.add(n)
        queue.push(n)
      }
    }
    const bs = [...seen].map((id) => top.get(id) as LaneBlock)
    const x = Math.min(...bs.map((b) => b.position.x)) - LANE.PAD
    const y = Math.min(...bs.map((b) => b.position.y)) - LANE.PAD - LANE.TITLE
    const right =
      Math.max(...bs.map((b) => b.position.x + (b.data?.width ?? LANE.BLOCK_WIDTH))) + LANE.PAD
    const bottom =
      Math.max(...bs.map((b) => b.position.y + (b.data?.height ?? LANE.BLOCK_HEIGHT))) + LANE.PAD
    regions.push({ triggerId: t.id, name: t.name, x, y, width: right - x, height: bottom - y })
  }
  const overlap = (a: LaneRegion, b: LaneRegion) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  for (let i = 0; i < regions.length; i++)
    for (let j = i + 1; j < regions.length; j++) if (overlap(regions[i], regions[j])) return []
  return regions
}
