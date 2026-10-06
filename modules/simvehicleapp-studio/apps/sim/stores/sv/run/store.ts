import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvLogLine, SvTraceEvent } from '@/lib/api/contracts/sv'

/** Entries the Run console keeps (virtualized list, ADR-0027 §5); the orchestrator keeps 20 000. */
export const SV_RUN_CONSOLE_LIMIT = 5000

/** One line of the Run console: a log line or a trace event. */
export type SvRunEntry =
  | {
      kind: 'log'
      seq: number
      ts: number
      level: SvLogLine['level']
      stream: SvLogLine['stream']
      text: string
    }
  | { kind: 'trace'; seq: number; ts: number; level: 'debug' | 'error'; event: SvTraceEvent }

/** What a block is doing in the live run (canvas overlay, shared look with the Simulate replay). */
export interface SvLiveBlock {
  state: 'running' | 'done' | 'error'
  /** Completed executions (exit events; a sampled event stands for `1 + data.dropped`). */
  runs: number
  open: number
  last?: string
  ts: number
}

interface SvRunState {
  projectId: string | null
  runId: string | null
  /** The followed run is starting/running/stopping: the canvas shows its live trace. */
  active: boolean
  entries: SvRunEntry[]
  lastSeq: number
  /** Live state per workflow, then per block. */
  blocks: Record<string, Record<string, SvLiveBlock>>
  /** Bumped to bring the Run console to the front. */
  focusRunConsole: number
  follow: (projectId: string, runId: string) => void
  setActive: (runId: string, active: boolean) => void
  ingest: (
    runId: string,
    items: { event: 'log' | 'trace'; data: SvLogLine | SvTraceEvent }[]
  ) => void
  showRunConsole: () => void
  clear: () => void
}

const initialState = {
  projectId: null as string | null,
  runId: null as string | null,
  active: false,
  entries: [] as SvRunEntry[],
  lastSeq: -1,
  blocks: {} as SvRunState['blocks'],
  focusRunConsole: 0,
}

const shown = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** Applies one trace event to the block it belongs to (pure: returns the new block state). */
export function reduceLiveBlock(prev: SvLiveBlock | undefined, e: SvTraceEvent): SvLiveBlock {
  const s: SvLiveBlock = prev ? { ...prev } : { state: 'done', runs: 0, open: 0, ts: e.ts }
  const n = 1 + (typeof e.data?.dropped === 'number' ? e.data.dropped : 0)
  s.ts = e.ts
  if (e.ev === 'enter') {
    s.open += n
    s.state = 'running'
  } else if (e.ev === 'exit' || e.ev === 'cancel') {
    s.open = Math.max(0, s.open - n)
    if (e.ev === 'exit') s.runs += n
    if (s.state !== 'error') s.state = s.open > 0 ? 'running' : 'done'
  } else if (e.ev === 'error') {
    s.state = 'error'
  }
  if (e.ev === 'write' && e.data && 'value' in e.data) s.last = shown(e.data.value)
  if (e.ev === 'value') s.last = shown(e.data?.message ?? e.data?.payload ?? '')
  return s
}

/** The live run followed by the editor: console entries and the live trace overlay (M08-T08). */
export const useSvRunStore = create<SvRunState>()(
  devtools(
    (set) => ({
      ...initialState,
      follow: (projectId, runId) =>
        set((s) =>
          s.runId === runId
            ? s
            : {
                ...initialState,
                projectId,
                runId,
                active: true,
                focusRunConsole: s.focusRunConsole + 1,
              }
        ),
      setActive: (runId, active) =>
        set((s) => (s.runId === runId && s.active !== active ? { active } : s)),
      ingest: (runId, items) =>
        set((s) => {
          if (s.runId !== runId) return s
          const fresh = items.filter((i) => i.data.seq > s.lastSeq)
          if (!fresh.length) return s
          const entries = [...s.entries]
          const blocks = { ...s.blocks }
          for (const { event, data } of fresh) {
            if (event === 'log') {
              const l = data as SvLogLine
              entries.push({
                kind: 'log',
                seq: l.seq,
                ts: l.ts,
                level: l.level,
                stream: l.stream,
                text: l.msg,
              })
              continue
            }
            const t = data as SvTraceEvent
            entries.push({
              kind: 'trace',
              seq: t.seq,
              ts: t.ts,
              level: t.ev === 'error' ? 'error' : 'debug',
              event: t,
            })
            if (t.wf && t.blockId) {
              const wf = { ...(blocks[t.wf] ?? {}) }
              wf[t.blockId] = reduceLiveBlock(wf[t.blockId], t)
              blocks[t.wf] = wf
            }
          }
          return {
            entries:
              entries.length > SV_RUN_CONSOLE_LIMIT
                ? entries.slice(-SV_RUN_CONSOLE_LIMIT)
                : entries,
            blocks,
            lastSeq: fresh[fresh.length - 1].data.seq,
          }
        }),
      showRunConsole: () => set((s) => ({ focusRunConsole: s.focusRunConsole + 1 })),
      clear: () => set(initialState),
    }),
    { name: 'sv-run-store' }
  )
)
