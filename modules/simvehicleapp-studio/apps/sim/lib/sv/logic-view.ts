import { blockSummary, type SvBlockRole } from '@/lib/sv/block-summary'
import { mapSimContainer } from '@/lib/sv/container-mapping'
import { svEdgeLabel } from '@/lib/sv/handle-labels'

/**
 * Logic view (ADR-0059 §2, M18-T07): the whole workflow as structured sentences, one paragraph per trigger — the
 * trigger, then each block it runs in order, branches nested under their label ("then", "else", "in time"…), the
 * blocks inside a Loop/Parallel nested under it. Deterministic: the same canvas state gives the same lines (the
 * sentences are the block summaries of ADR-0055, no LLM). Blocks no trigger reaches end in a last paragraph.
 */

export interface LogicStateBlock {
  id: string
  type: string
  name: string
  enabled?: boolean
  position?: { x: number; y: number }
  subBlocks?: Record<string, { value?: unknown } | undefined>
  data?: {
    parentId?: string | null
    loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
    count?: number
    whileCondition?: string
    parallelType?: 'count' | 'collection'
  }
}

export interface LogicState {
  blocks: Record<string, LogicStateBlock>
  edges: { source: string; sourceHandle?: string | null; target: string }[]
  loops?: Record<
    string,
    {
      loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
      iterations?: number
      whileCondition?: string
    }
  >
  parallels?: Record<string, { parallelType?: 'count' | 'collection'; count?: number }>
}

export type LogicLineKind = 'trigger' | 'step' | 'branch' | 'ref'

export interface LogicLine {
  /** The block the line stands for (a branch line: the block the branch leaves). */
  blockId: string
  kind: LogicLineKind
  depth: number
  text: string
  role?: SvBlockRole
  /** Branch lines: the handle (`then`, `case-1`…). */
  handle?: string
}

export interface LogicParagraph {
  /** `null` for the blocks no trigger reaches. */
  triggerId: string | null
  lines: LogicLine[]
}

/** Branch handles in reading order; others follow alphabetically. */
const HANDLE_ORDER = [
  'then',
  'stable',
  'ok',
  'changed',
  'default',
  'else',
  'broken',
  'timeout',
  'unchanged',
  'error',
]
const handleRank = (h: string) => {
  const c = /^case-(\d+)$/.exec(h)
  if (c) return 2.5 + Number(c[1]) / 1000
  const i = HANDLE_ORDER.indexOf(h)
  return i === -1 ? HANDLE_ORDER.length : i
}
const isStart = (h: string) => /-start-source$/.test(h)
const isSequence = (h: string) => h === 'source' || h === 'next' || /-end-source$/.test(h)

const valuesOf = (b: LogicStateBlock) =>
  Object.fromEntries(Object.entries(b.subBlocks ?? {}).map(([k, s]) => [k, s?.value]))

/** Sentence of one block: its summary, a Loop/Parallel as the vehicle container it maps to, else its name. */
function sentence(b: LogicStateBlock, state: LogicState): { text: string; role?: SvBlockRole } {
  if (b.type === 'loop' || b.type === 'parallel') {
    const mapped =
      b.type === 'loop'
        ? mapSimContainer({
            type: 'loop',
            loopType: state.loops?.[b.id]?.loopType ?? b.data?.loopType,
            iterations: state.loops?.[b.id]?.iterations ?? b.data?.count,
            whileCondition: state.loops?.[b.id]?.whileCondition ?? b.data?.whileCondition,
          })
        : mapSimContainer({
            type: 'parallel',
            parallelType: state.parallels?.[b.id]?.parallelType ?? b.data?.parallelType,
            count: state.parallels?.[b.id]?.count ?? b.data?.count,
          })
    if ('type' in mapped) {
      const s = blockSummary(mapped.type, mapped.props)
      if (s) return { text: `${s.text} (${b.name})`, role: s.role }
    }
    return { text: b.name, role: 'flow' }
  }
  const s = blockSummary(b.type, valuesOf(b))
  return s ? { text: s.text, role: s.role } : { text: b.name }
}

/** Canvas order: top to bottom, then left to right, then id. */
function byPosition(a: LogicStateBlock, b: LogicStateBlock): number {
  const ay = a.position?.y ?? 0
  const by = b.position?.y ?? 0
  if (ay !== by) return ay - by
  const ax = a.position?.x ?? 0
  const bx = b.position?.x ?? 0
  if (ax !== bx) return ax - bx
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function logicView(state: LogicState): LogicParagraph[] {
  const blocks = new Map(
    Object.values(state.blocks)
      .filter((b) => b.enabled !== false)
      .map((b) => [b.id, b])
  )
  const out = new Map<string, Map<string, LogicStateBlock[]>>()
  for (const e of state.edges) {
    const from = blocks.get(e.source)
    const to = blocks.get(e.target)
    if (!from || !to) continue
    const handle = e.sourceHandle ?? 'source'
    const byHandle = out.get(from.id) ?? new Map<string, LogicStateBlock[]>()
    byHandle.set(handle, [...(byHandle.get(handle) ?? []), to])
    out.set(from.id, byHandle)
  }
  for (const byHandle of out.values()) for (const list of byHandle.values()) list.sort(byPosition)

  const reached = new Set<string>()
  const paragraphs: LogicParagraph[] = []

  const walk = (b: LogicStateBlock, depth: number, lines: LogicLine[], seen: Set<string>) => {
    if (seen.has(b.id)) {
      lines.push({ blockId: b.id, kind: 'ref', depth, text: `continues at "${b.name}"` })
      return
    }
    seen.add(b.id)
    reached.add(b.id)
    const s = sentence(b, state)
    const isTrigger = lines.length === 0
    lines.push({ blockId: b.id, kind: isTrigger ? 'trigger' : 'step', depth, ...s })
    // What a trigger runs reads one level under its "When …" line.
    const inner = isTrigger ? depth + 1 : depth
    const byHandle = out.get(b.id) ?? new Map<string, LogicStateBlock[]>()
    const handles = [...byHandle.keys()]
    // Inside a container first, then its branches, then what follows it.
    for (const h of handles.filter(isStart).sort())
      for (const child of byHandle.get(h) ?? []) walk(child, inner + 1, lines, seen)
    const branches = handles
      .filter((h) => !isStart(h) && !isSequence(h))
      .sort((x, y) => handleRank(x) - handleRank(y) || (x < y ? -1 : 1))
    for (const h of branches) {
      lines.push({
        blockId: b.id,
        kind: 'branch',
        depth: inner + 1,
        text: svEdgeLabel(h) ?? h,
        handle: h,
      })
      for (const child of byHandle.get(h) ?? []) walk(child, inner + 2, lines, seen)
    }
    for (const h of handles.filter(isSequence).sort())
      for (const next of byHandle.get(h) ?? []) walk(next, inner, lines, seen)
  }

  const triggers = [...blocks.values()]
    .filter((b) => !b.data?.parentId && sentence(b, state).role === 'when')
    .sort(byPosition)
  for (const t of triggers) {
    const lines: LogicLine[] = []
    walk(t, 0, lines, new Set())
    paragraphs.push({ triggerId: t.id, lines })
  }

  const left = [...blocks.values()].filter((b) => !reached.has(b.id)).sort(byPosition)
  if (left.length)
    paragraphs.push({
      triggerId: null,
      lines: left.map((b) => ({
        blockId: b.id,
        kind: 'step' as const,
        depth: b.data?.parentId ? 1 : 0,
        ...sentence(b, state),
      })),
    })
  return paragraphs
}

/** Plain text of the Logic view (copy, tests): two spaces per depth, branches as `label ⇒`. */
export function logicText(paragraphs: LogicParagraph[]): string {
  return paragraphs
    .map((p) => {
      const head = p.triggerId === null ? ['Not run by any trigger:'] : []
      const body = p.lines.map((l) => {
        const indent = '  '.repeat(l.depth)
        if (l.kind === 'trigger') return `${l.text}:`
        if (l.kind === 'branch') return `${indent}${l.text} ⇒`
        if (l.kind === 'ref') return `${indent}↺ ${l.text}`
        return `${indent}${l.text}`
      })
      return [...head, ...body].join('\n')
    })
    .join('\n\n')
}
