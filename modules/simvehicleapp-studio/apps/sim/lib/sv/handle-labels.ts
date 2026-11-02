import { type SvMessageKey, svT } from '@/lib/sv/i18n'

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
  /** SV: RobotFlow outcomes (ADR-0067). */
  failed: 'error',
  body: 'positive',
  done: 'negative',
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

const EDGE_LABEL: Record<string, SvMessageKey> = {
  then: 'edge.then',
  else: 'edge.else',
  stable: 'edge.stable',
  broken: 'edge.broken',
  ok: 'edge.inTime',
  timeout: 'edge.timeout',
  changed: 'edge.changed',
  unchanged: 'edge.unchanged',
  default: 'edge.default',
  error: 'edge.onError',
}

/** Labels of RobotFlow ports (robot workflows, ADR-0067); `next` stays unlabelled. */
const ROBOT_EDGE_LABEL: Record<string, SvMessageKey> = {
  ok: 'rf.port.ok',
  failed: 'rf.port.failed',
  then: 'rf.port.then',
  else: 'rf.port.else',
  timeout: 'rf.port.timeout',
  body: 'rf.port.body',
  done: 'rf.port.done',
}

/**
 * Label of an edge leaving a named branch (`then`, `in time`, `case 2`…) in the page's language, or `null` for a
 * plain sequence edge, which stays unlabelled so the canvas is not cluttered.
 */
export function svEdgeLabel(handleId: string | null | undefined, robot = false): string | null {
  if (!handleId) return null
  const key = robot ? ROBOT_EDGE_LABEL[handleId] : EDGE_LABEL[handleId]
  if (key) return svT(key)
  const caseIndex = /^case-(\d+)$/.exec(handleId)
  if (!robot && caseIndex) return svT('edge.case', { n: Number(caseIndex[1]) + 1 })
  return null
}
