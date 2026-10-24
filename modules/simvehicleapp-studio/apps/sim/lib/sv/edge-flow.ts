/**
 * Live values on the canvas (ADR-0059 §4, M18-T08): which way the workflow went, from the trace of the Simulate
 * replay (up to the cursor) or of the live run. For each block, its last exit and the branch it took; an edge is
 * `taken` when its source left through its handle that time, `skipped` when the source took another branch, else
 * `idle`. The edges leaving a trigger carry the value it fired with.
 */

export interface BlockFlow {
  /** Branch of the last exit (`then`, `stable`…); none for a block without branches. */
  handle?: string
  /** Value the trigger fired with last (`outputs.value`), for the edges leaving it. */
  value?: unknown
}

interface TraceLike {
  ev: string
  ts: number
  blockId?: string
  data?: Record<string, unknown>
}

/** Last exit per block at time `at` (inclusive); trace in time order. */
export function flowAt(
  trace: readonly TraceLike[],
  at = Number.POSITIVE_INFINITY
): Record<string, BlockFlow> {
  const out: Record<string, BlockFlow> = {}
  for (const e of trace) {
    if (e.ts > at) break
    if (!e.blockId) continue
    if (e.ev === 'trigger') {
      const outputs = (e.data as { outputs?: Record<string, unknown> } | undefined)?.outputs
      out[e.blockId] = { ...(outputs && 'value' in outputs ? { value: outputs.value } : {}) }
    } else if (e.ev === 'exit') {
      const handle = (e.data as { handle?: unknown } | undefined)?.handle
      out[e.blockId] = {
        ...(out[e.blockId]?.value !== undefined ? { value: out[e.blockId]?.value } : {}),
        ...(typeof handle === 'string' ? { handle } : {}),
      }
    }
  }
  return out
}

export type EdgeFlowState = 'taken' | 'skipped' | 'idle'

/** Handles that do not choose a way: an exit through them takes every such edge. */
const SEQUENCE = (h: string | null | undefined) =>
  !h || h === 'source' || h === 'next' || /-(start|end)-source$/.test(h)

export function edgeFlowState(
  flow: BlockFlow | undefined,
  sourceHandle: string | null | undefined
): EdgeFlowState {
  if (!flow) return 'idle'
  if (SEQUENCE(sourceHandle)) return 'taken'
  if (!flow.handle) return 'idle'
  return flow.handle === sourceHandle ? 'taken' : 'skipped'
}
