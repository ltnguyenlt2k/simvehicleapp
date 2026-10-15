/**
 * Branch handles of vehicle blocks (ADR-0055, M16-T08/T09): the tone of each outcome, shared by the block's handles
 * and the edges leaving them, so "then"/"stable"/"in time" read green, "broken"/"timeout" amber and "error" red
 * everywhere on the canvas. Labels come from the block config (`svHandles`); this table only adds the meaning.
 */

export type SvHandleTone = 'positive' | 'negative' | 'warning' | 'error' | 'neutral'

const TONE: Record<string, SvHandleTone> = {
  then: 'positive',
  stable: 'positive',
  ok: 'positive',
  changed: 'positive',
  else: 'negative',
  default: 'negative',
  unchanged: 'negative',
  broken: 'warning',
  timeout: 'warning',
  error: 'error',
}

/** Tone of a handle id; `case-<i>` handles of Switch are positive (a case matched). */
export function svHandleTone(handleId: string | null | undefined): SvHandleTone {
  if (!handleId) return 'neutral'
  if (handleId.startsWith('case-')) return 'positive'
  return TONE[handleId] ?? 'neutral'
}

/** CSS colour of a tone (existing design tokens only). */
export const SV_HANDLE_COLOR: Record<SvHandleTone, string> = {
  positive: 'var(--text-success)',
  negative: 'var(--text-muted)',
  warning: 'var(--warning)',
  error: 'var(--text-error)',
  neutral: 'var(--workflow-edge)',
}

/** Tailwind background of a handle of that tone (the handles' own classes use `!bg-*`). */
export const SV_HANDLE_BG: Record<SvHandleTone, string> = {
  positive: '!bg-[var(--text-success)]',
  negative: '!bg-[var(--text-muted)]',
  warning: '!bg-[var(--warning)]',
  error: '!bg-[var(--text-error)]',
  neutral: '!bg-[var(--workflow-edge)]',
}

const EDGE_LABEL: Record<string, string> = {
  then: 'then',
  else: 'else',
  stable: 'stable',
  broken: 'broken',
  ok: 'in time',
  timeout: 'timeout',
  changed: 'changed',
  unchanged: 'unchanged',
  default: 'default',
  error: 'on error',
}

/**
 * Label of an edge leaving a named branch (`then`, `in time`, `case 2`…), or `null` for a plain sequence edge, which
 * stays unlabelled so the canvas is not cluttered.
 */
export function svEdgeLabel(handleId: string | null | undefined): string | null {
  if (!handleId) return null
  const caseIndex = /^case-(\d+)$/.exec(handleId)
  if (caseIndex) return `case ${Number(caseIndex[1]) + 1}`
  return EDGE_LABEL[handleId] ?? null
}
