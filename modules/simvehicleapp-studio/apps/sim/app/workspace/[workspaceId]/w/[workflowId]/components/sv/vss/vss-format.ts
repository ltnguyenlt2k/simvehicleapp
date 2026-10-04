import type { SvVssNode, SvVssNodeKind } from '@/lib/api/contracts/sv'

/** VSS kinds a vehicle block may bind to (ADR-0010 §6); branches only group the tree. */
export type SvVssLeafKind = Exclude<SvVssNodeKind, 'branch'>

export const SV_VSS_KIND_LABEL: Record<SvVssNodeKind, string> = {
  branch: 'Branch',
  sensor: 'Sensor',
  actuator: 'Actuator',
  attribute: 'Attribute',
}

/** `float · km/h`, `string[]`, `uint8 · percent`; empty for branches. */
export function formatVssType(node: Pick<SvVssNode, 'datatype' | 'unit'>): string {
  if (!node.datatype) return ''
  return node.unit ? `${node.datatype} · ${node.unit}` : node.datatype
}

/** Array datatypes are read-only in v1 (ADR-0018 §2). */
export function isVssArray(node: Pick<SvVssNode, 'datatype'>): boolean {
  return node.datatype?.endsWith('[]') ?? false
}

/** Range or enum hint shown under the type, e.g. `0 … 100` or `OFF, SLOW, … (6)`. */
export function formatVssDomain(
  node: Pick<SvVssNode, 'min' | 'max' | 'allowed'>,
  maxValues = 4
): string {
  if (node.allowed && node.allowed.length > 0) {
    const shown = node.allowed.slice(0, maxValues).map(String).join(', ')
    return node.allowed.length > maxValues ? `${shown}, … (${node.allowed.length})` : shown
  }
  if (node.min !== undefined && node.max !== undefined) return `${node.min} … ${node.max}`
  if (node.min !== undefined) return `≥ ${node.min}`
  if (node.max !== undefined) return `≤ ${node.max}`
  return ''
}

export interface VssSelectability {
  selectable: boolean
  /** Why a leaf cannot be picked for this block; undefined when selectable or a branch. */
  reason?: string
}

/**
 * Whether `node` can be bound to a block that accepts `kinds` (BlockSpec `vssKinds`). Branches are
 * never selectable (they only expand). Array actuators are refused for writing blocks (ADR-0018 §2).
 */
export function vssSelectability(
  node: Pick<SvVssNode, 'kind' | 'datatype'>,
  kinds: readonly SvVssLeafKind[],
  options: { writes?: boolean } = {}
): VssSelectability {
  if (node.kind === 'branch') return { selectable: false }
  if (!kinds.includes(node.kind)) {
    const allowed = kinds.map((k) => SV_VSS_KIND_LABEL[k].toLowerCase()).join(' or ')
    return { selectable: false, reason: `This block needs a ${allowed}` }
  }
  if (options.writes && isVssArray(node)) {
    return { selectable: false, reason: 'Array signals are read-only' }
  }
  return { selectable: true }
}

/** Kind filter for the search API: one kind ⇒ server-side filter, several ⇒ filter on the client. */
export function searchKindFilter(kinds: readonly SvVssLeafKind[]): SvVssLeafKind | undefined {
  return kinds.length === 1 ? kinds[0] : undefined
}
