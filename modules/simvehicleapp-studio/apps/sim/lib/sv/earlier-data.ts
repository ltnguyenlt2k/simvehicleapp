import { blockRefs } from '@/lib/sv/block-refs'
import { normalizeName } from '@/executor/constants'

/**
 * "Data from earlier blocks" (ADR-0059 §5, M18-T08): what the editor shows under a vehicle block's settings — the
 * outputs of the blocks that run before it, with a sample value from the last Simulate or Run, and, the other way
 * round, the blocks that use this block's outputs ("Used by", the "uses:" chips of M16-T09 seen from the source).
 */

export interface UsedByBlock {
  id: string
  name: string
  /** The references to this block it holds, as written: `speedchanged.value`. */
  refs: string[]
}

interface BlockLike {
  id: string
  name: string
  subBlocks?: Record<string, { value?: unknown } | undefined>
}

const valuesOf = (b: BlockLike) =>
  Object.fromEntries(Object.entries(b.subBlocks ?? {}).map(([k, s]) => [k, s?.value]))

/** Blocks whose settings refer to an output of `blockId`, in name order. */
export function usedBy(blocks: Record<string, BlockLike>, blockId: string): UsedByBlock[] {
  const source = blocks[blockId]
  if (!source) return []
  const name = normalizeName(source.name)
  return Object.values(blocks)
    .filter((b) => b.id !== blockId)
    .flatMap((b) => {
      const refs = blockRefs(valuesOf(b)).filter((r) => r.block === name)
      return refs.length ? [{ id: b.id, name: b.name, refs: refs.map((r) => r.text) }] : []
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

interface TraceLike {
  ev: string
  blockId?: string
  data?: Record<string, unknown>
}

/**
 * Value an output of a block had the last time it ran (`trigger` events carry the trigger's outputs), or `undefined`
 * when the trace has none. `path` is the output field, possibly nested (`value`, `timestamp`, `payload.x`).
 */
export function sampleValue(trace: readonly TraceLike[], blockId: string, path: string): unknown {
  for (let i = trace.length - 1; i >= 0; i--) {
    const e = trace[i]
    if (e.blockId !== blockId || e.ev !== 'trigger') continue
    let v: unknown = (e.data as { outputs?: unknown } | undefined)?.outputs
    for (const key of path.split('.')) {
      if (!v || typeof v !== 'object') return undefined
      v = (v as Record<string, unknown>)[key]
    }
    return v
  }
  return undefined
}

/** A sample value as a short text: strings quoted, long values cut. */
export function sampleText(value: unknown): string {
  const text =
    typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value))
  return text.length > 24 ? `${text.slice(0, 23)}…` : text
}
