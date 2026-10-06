'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Badge, ChipInput, ChipSelect, ChipSwitch } from '@/components/emcn'
import type { SvRun } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
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

/** One console line: the log text, or a trace event as `node ev (block) value`. */
export function entryText(
  e: SvRunEntry,
  blockName?: (blockId: string) => string | undefined
): string {
  if (e.kind === 'log') return e.text
  const t = e.event
  const where = t.blockId ? (blockName?.(t.blockId) ?? t.blockId) : undefined
  const data = t.data && Object.keys(t.data).length ? ` ${JSON.stringify(t.data)}` : ''
  return `▸ ${t.node ? `${t.node} ` : ''}${t.ev}${where ? ` · ${where}` : ''}${data}`
}

interface RunConsoleProps {
  run?: SvRun
  blockName?: (blockId: string) => string | undefined
}

/**
 * Run console (M08-T08, ADR-0027 §5): the live run's log and trace, virtualized (the store keeps the
 * newest 5 000 entries), filtered by level and text; sticks to the bottom while the user is there.
 */
export function RunConsole({ run, blockName }: RunConsoleProps) {
  const entries = useSvRunStore((s) => s.entries)
  const [level, setLevel] = useState<(typeof LEVELS)[number]['value']>('all')
  const [showTrace, setShowTrace] = useState(true)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (e.kind === 'trace' && !showTrace) return false
      if (level !== 'all' && RANK[e.level] < RANK[level]) return false
      return !q || entryText(e, blockName).toLowerCase().includes(q)
    })
  }, [entries, level, showTrace, query, blockName])

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
        <ChipInput
          aria-label='Search the run log'
          placeholder='Search'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='w-[200px]'
        />
        <span className='ml-auto text-[11px] text-[var(--text-muted)]'>
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
                      : e.kind === 'trace' || (e.kind === 'log' && e.stream === 'system')
                        ? 'text-[var(--text-secondary)]'
                        : 'text-[var(--text-primary)]'
                )}
                style={{ top: row.start, height: ROW_HEIGHT }}
                title={entryText(e, blockName)}
              >
                {entryText(e, blockName)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
