import { SYSTEM_REFERENCE_PREFIXES } from '@/lib/workflows/sanitization/references'

/**
 * Outputs of other blocks a vehicle block reads (ADR-0055, M16-T09): `<speedchanged.value>` in any of its props.
 * Signals (`<Vehicle.Speed>`) and loop/parallel/variable references are not block outputs. The canvas shows them as
 * "uses:" chips; hovering one highlights the block it comes from.
 */
export interface SvBlockRef {
  /** Normalized name of the source block (as references write it). */
  block: string
  /** The reference as written, without the brackets: `speedchanged.value`. */
  text: string
}

const REF = /<([a-z0-9_]+)\.([A-Za-z0-9_.[\]]+)>/g

function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
}

/** Block outputs the props refer to, in order of first use, each once. */
export function blockRefs(values: Record<string, unknown>): SvBlockRef[] {
  const texts: string[] = []
  strings(values, texts)
  const seen = new Set<string>()
  const refs: SvBlockRef[] = []
  for (const text of texts) {
    for (const m of text.matchAll(REF)) {
      const [, block, path] = m
      if (SYSTEM_REFERENCE_PREFIXES.has(block)) continue
      const ref = `${block}.${path}`
      if (seen.has(ref)) continue
      seen.add(ref)
      refs.push({ block, text: ref })
    }
  }
  return refs
}
