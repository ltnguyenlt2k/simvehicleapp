'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge, ChipInput, ChipSelect, ChipSwitch } from '@/components/emcn'
import type { SvRun } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { evalText, type FlowEval, type FlowSignal, SOURCE_TEXT } from '@/lib/sv/flow-trace'
import { type SvRunEntry, useSvRunStore } from '@/stores/sv/run/store'

const LEVELS = [
  { label: 'All levels', value: 'all' },
  { label: 'Info and above', value: 'info' },
  { label: 'Warnings and errors', value: 'warn' },
  { label: 'Errors', value: 'error' },
] as const
const RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const
const ROW_HEIGHT = 18

const STATE_VARIANT = {
  starting: 'blue',
  running: 'green',
  stopping: 'amber',
  stopped: 'gray',
  crashed: 'red',
} as const

/** A console row: an entry of the run, or a signal value the user injected or a playback set (ADR-0062 §3). */
export type ConsoleRow =
  | SvRunEntry
  | { kind: 'input'; seq: string; ts: number; level: 'info'; signal: FlowSignal }

const shown = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** One console line: the log text, or a trace event as a sentence (`raw`: as `node ev (block) data`). */
export function entryText(
  e: ConsoleRow,
  blockName?: (blockId: string) => string | undefined,
  raw = false
): string {
  if (e.kind === 'log') return e.text
  if (e.kind === 'input') {
    const s = e.signal
    return `● ${s.path} = ${shown(s.value)}${s.field === 'target' ? ' (target)' : ''} — ${SOURCE_TEXT[s.source ?? ''] ?? s.source}`
  }
  const t = e.event
  const where = t.blockId ? (blockName?.(t.blockId) ?? t.blockId) : undefined
  if (raw || !where) {
    const data = t.data && Object.keys(t.data).length ? ` ${JSON.stringify(t.data)}` : ''
    return `▸ ${t.node ? `${t.node} ` : ''}${t.ev}${where ? ` · ${where}` : ''}${data}`
  }
  const d = (t.data ?? {}) as Record<string, unknown>
  const run = t.run === undefined ? '' : ` (run ${t.run})`
  switch (t.ev) {
    case 'trigger': {
      const value = (d.outputs as { value?: unknown } | undefined)?.value
      return `▶ ${where} fired${run}${value === undefined ? '' : ` with ${shown(value)}`}`
    }
    case 'enter':
      return `  → ${where}`
    case 'exit': {
      const handle =
        typeof d.handle === 'string' && d.handle !== 'next' ? ` → ${d.handle}` : ' done'
      const why = d.eval && typeof d.eval === 'object' ? ` (${evalText(d.eval as FlowEval)})` : ''
      return `  ← ${where}${handle}${why}`
    }
    case 'write':
      return `  ${where} writes ${String(d.path)} = ${shown(d.value)}`
    case 'value':
      return d.kind === 'mqtt'
        ? `  ${where} publishes ${String(d.topic)}: ${String(d.payload ?? '')}`
        : `  ${where} logs: ${String(d.message ?? '')}`
    case 'error':
      return `✖ ${where} failed${run}: ${String(d.reason ?? 'error')}${d.message ? ` — ${String(d.message)}` : ''}`
    case 'cancel':
      return `  ${where} cancelled${run}${d.reason ? ` (${String(d.reason)})` : ''}`
    default:
      return `▸ ${where} ${t.ev}`
  }
}

/** Run entries and input lines in time order (inputs before the entries of the same millisecond). */
export function consoleRows(
  entries: readonly SvRunEntry[],
  signals: readonly FlowSignal[]
): ConsoleRow[] {
  const inputs: ConsoleRow[] = signals
    .filter((s) => s.source === 'inject' || s.source === 'playback')
    .map((s, i) => ({ kind: 'input', seq: `i${i}`, ts: s.ts, level: 'info', signal: s }))
  if (!inputs.length) return [...entries]
  const out: ConsoleRow[] = []
  let i = 0
  for (const e of entries) {
    while (i < inputs.length && (inputs[i] as ConsoleRow).ts <= e.ts)
      out.push(inputs[i++] as ConsoleRow)
    out.push(e)
  }
  return out.concat(inputs.slice(i))
}

interface RunConsoleProps {
  run?: SvRun
  blockName?: (blockId: string) => string | undefined
}

/**
 * Run console (M08-T08, ADR-0027 §5): the live run's log and trace, virtualized (the store keeps the
 * newest 5 000 entries), filtered by level and text; sticks to the bottom while the user is there. Trace events read
 * as sentences (Raw shows the events), and the values the user injected or a playback set appear as input lines
 * (M19-T05).
 */
export function RunConsole({ run, blockName }: RunConsoleProps) {
  const entries = useSvRunStore((s) => s.entries)
  const signals = useSvRunStore((s) => s.signals)
  const [raw, setRaw] = useState(false)
  const [level, setLevel] = useState<(typeof LEVELS)[number]['value']>('all')
  const [showTrace, setShowTrace] = useState(true)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return consoleRows(entries, signals).filter((e) => {
      if (e.kind !== 'log' && !showTrace) return false
      if (level !== 'all' && RANK[e.level] < RANK[level]) return false
      return !q || entryText(e, blockName, raw).toLowerCase().includes(q)
    })
  }, [entries, signals, level, showTrace, query, blockName, raw])

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  })

  useEffect(() => {
    if (stick.current && visible.length)
      virtualizer.scrollToIndex(visible.length - 1, { align: 'end' })
  }, [visible.length, virtualizer])

  return (
    <div data-sv='run-console' className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b px-2 py-1'>
        {run ? (
          <Badge
            size='sm'
            variant={STATE_VARIANT[run.state]}
            data-sv='run-state'
            data-sv-state={run.state}
          >
            {run.state}
          </Badge>
        ) : (
          <span className='text-[12px] text-[var(--text-muted)]'>No run yet — press Run</span>
        )}
        <ChipSelect
          aria-label='Log level'
          value={level}
          onChange={(v) => setLevel(v as typeof level)}
          options={LEVELS.map((l) => ({ label: l.label, value: l.value }))}
        />
        <ChipSwitch
          aria-label='Entries'
          value={showTrace ? 'all' : 'logs'}
          onChange={(v) => setShowTrace(v === 'all')}
          options={[
            { label: 'Logs + trace', value: 'all' },
            { label: 'Logs', value: 'logs' },
          ]}
        />
        <ChipSwitch
          aria-label='Trace as'
          value={raw ? 'raw' : 'sentences'}
          onChange={(v) => setRaw(v === 'raw')}
          options={[
            { label: 'Sentences', value: 'sentences' },
            { label: 'Raw', value: 'raw' },
          ]}
        />
        <ChipInput
          aria-label='Search the run log'
          placeholder='Search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='w-[200px]'
        />
        {(run?.state === 'starting' || run?.state === 'running') && (
          <span
            data-sv='ide-parallel-hint'
            className='truncate text-[11px] text-[var(--text-muted)]'
            title='The IDE task "SimVehicleApp: Run on stack" uses the same databroker and MQTT broker (M09-T05)'
          >
            Running the app from the IDE too? Both drive the same signals — stop one.
          </span>
        )}
        <span className='ml-auto shrink-0 text-[11px] text-[var(--text-muted)]'>
          {`${visible.length} / ${entries.length}`}
        </span>
      </div>
      <div
        ref={scrollRef}
        role='log'
        aria-label='Run console'
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2
        }}
        className='min-h-0 flex-1 overflow-auto font-mono text-[11px]'
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const e = visible[row.index]
            return (
              <div
                key={e.seq}
                data-sv-entry={e.kind}
                className={cn(
                  'absolute left-0 w-full truncate whitespace-pre px-2 leading-[18px]',
                  e.level === 'error'
                    ? 'text-[var(--text-error)]'
                    : e.level === 'warn'
                      ? 'text-[var(--text-warning,var(--text-primary))]'
                      : e.kind !== 'log' || e.stream === 'system'
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-primary)]'
                )}
                style={{ top: row.start, height: ROW_HEIGHT }}
                title={entryText(e, blockName, raw)}
              >
                {entryText(e, blockName, raw)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
