'use client'

import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Download } from 'lucide-react'
import { Button, ChipSelect } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  evalText,
  type FlowOutcome,
  type FlowRun,
  type FlowSignal,
  type FlowStep,
  type FlowTraceEvent,
  flowJsonl,
  flowRuns,
  SOURCE_TEXT,
  stepDuration,
} from '@/lib/sv/flow-trace'
import { SV_HANDLE_COLOR, svHandleTone } from '@/lib/sv/handle-labels'

const OUTCOMES = [
  { label: 'Any result', value: 'all' },
  { label: 'Done', value: 'done' },
  { label: 'Running', value: 'running' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Error', value: 'error' },
] as const

const OUTCOME_TEXT: Record<FlowOutcome, string> = {
  done: 'done',
  running: 'running…',
  cancelled: 'cancelled',
  error: 'failed',
}

const OUTCOME_TONE: Record<FlowOutcome, string> = {
  done: 'text-[var(--text-muted)]',
  running: 'text-[var(--text-secondary)]',
  cancelled: 'text-[var(--warning)]',
  error: 'text-[var(--text-error)]',
}

const shown = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

interface FlowPanelProps {
  trace: readonly FlowTraceEvent[]
  signals?: readonly FlowSignal[]
  blockName?: (blockId: string) => string | undefined
  /** Bring a block into view (selects it on the canvas). */
  onSelectBlock?: (blockId: string) => void
  /** Simulate: the replay time; the run that spans it is highlighted. */
  activeAt?: number
  /** Simulate: a run was picked (the replay jumps to its start). */
  onPickRun?: (run: FlowRun) => void
  /** How a trace time reads: virtual ms in Simulate, the clock in Live. */
  timeText?: (ts: number) => string
  /** Live: newest runs keep coming; follow them until the user scrolls. */
  live?: boolean
  emptyText: string
  downloadName: string
}

/**
 * Flow (M19-T04, ADR-0062 §1): each run of a trigger, newest first — what fired it and where the value came from,
 * the blocks it went through with the branch each decision took and why, how long it took, and what it wrote,
 * logged or published. The same view in Live, Simulate and every test case.
 */
export function FlowPanel({
  trace,
  signals,
  blockName,
  onSelectBlock,
  activeAt,
  onPickRun,
  timeText = (ts) => `${ts} ms`,
  live = false,
  emptyText,
  downloadName,
}: FlowPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [trigger, setTrigger] = useState('all')
  const [outcome, setOutcome] = useState<(typeof OUTCOMES)[number]['value']>('all')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [paused, setPaused] = useState(false)

  const flow = useMemo(() => flowRuns(trace, signals), [trace, signals])
  const name = (id: string) => blockName?.(id) ?? id
  const triggers = useMemo(() => [...new Set(flow.runs.map((r) => r.trigger.blockId))], [flow.runs])
  const runs = flow.runs.filter(
    (r) =>
      (trigger === 'all' || r.trigger.blockId === trigger) &&
      (outcome === 'all' || r.outcome === outcome)
  )
  const active =
    activeAt === undefined
      ? undefined
      : runs.find(
          (r) => r.startedAt <= activeAt && activeAt <= (r.endedAt ?? Number.POSITIVE_INFINITY)
        )?.key
  const isOpen = (r: FlowRun, i: number) => open[r.key] ?? (i === 0 || r.key === active)

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([flowJsonl(trace, flow)], { type: 'application/x-ndjson' })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = downloadName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-sv='flow' className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b px-2 py-1'>
        <ChipSelect
          aria-label='Trigger'
          value={trigger}
          onChange={setTrigger}
          options={[
            { label: 'All triggers', value: 'all' },
            ...triggers.map((id) => ({ label: name(id), value: id })),
          ]}
        />
        <ChipSelect
          aria-label='Result'
          value={outcome}
          onChange={(v) => setOutcome(v as typeof outcome)}
          options={OUTCOMES.map((o) => ({ label: o.label, value: o.value }))}
        />
        {live && paused && (
          <Button
            size='sm'
            variant='ghost'
            data-sv='flow-follow'
            onClick={() => {
              scrollRef.current?.scrollTo({ top: 0 })
              setPaused(false)
            }}
          >
            ⏸ Paused — show newest
          </Button>
        )}
        <span
          className='ml-auto shrink-0 text-[11px] text-[var(--text-muted)]'
          data-sv='flow-count'
        >
          {`${runs.length} run${runs.length === 1 ? '' : 's'}${flow.hidden ? ` · ${flow.hidden} older hidden` : ''}`}
        </span>
        <Button
          size='sm'
          variant='ghost'
          aria-label='Download the flow as JSONL'
          disabled={!trace.length}
          onClick={download}
        >
          <Download className='size-[14px]' />
        </Button>
      </div>
      <div
        ref={scrollRef}
        role='log'
        aria-label='Flow'
        onScroll={(e) => setPaused(e.currentTarget.scrollTop > 8)}
        className='min-h-0 flex-1 overflow-y-auto text-caption'
      >
        {!runs.length ? (
          <p className='px-3 py-2 text-[var(--text-muted)]'>{emptyText}</p>
        ) : (
          <ul>
            {runs.map((r, i) => (
              <li
                key={r.key}
                data-sv-flow-run={r.run}
                data-sv-outcome={r.outcome}
                className={cn(
                  'border-[var(--border)] border-b',
                  r.key === active && 'bg-[var(--surface-active)]'
                )}
              >
                <button
                  type='button'
                  className='flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-[var(--surface-active)]'
                  onClick={() => {
                    setOpen((o) => ({ ...o, [r.key]: !isOpen(r, i) }))
                    onPickRun?.(r)
                  }}
                >
                  {isOpen(r, i) ? (
                    <ChevronDown className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  ) : (
                    <ChevronRight className='size-[14px] shrink-0 text-[var(--text-icon)]' />
                  )}
                  <span className='w-[88px] shrink-0 text-[var(--text-muted)] tabular-nums'>
                    {timeText(r.startedAt)}
                  </span>
                  <span className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
                    {name(r.trigger.blockId)}
                    <span className='text-[var(--text-muted)]'> · {causeText(r)}</span>
                  </span>
                  <span className={cn('shrink-0', OUTCOME_TONE[r.outcome])}>
                    {OUTCOME_TEXT[r.outcome]}
                    {r.endedAt !== undefined && ` in ${r.endedAt - r.startedAt} ms`}
                  </span>
                </button>
                {isOpen(r, i) && (
                  <ol className='pb-1 pl-[30px]'>
                    {r.steps.map((s, k) => (
                      <StepRow
                        key={`${s.node}-${k}`}
                        step={s}
                        name={name(s.blockId)}
                        onSelect={() => onSelectBlock?.(s.blockId)}
                      />
                    ))}
                    {!r.steps.length && (
                      <li className='text-[var(--text-muted)]'>No block ran after the trigger</li>
                    )}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** `Vehicle.Speed = 135 (you injected)`, or the trigger's own value when no signal change matches. */
function causeText(r: FlowRun): string {
  if (r.cause) {
    const from = r.cause.source ? ` (${SOURCE_TEXT[r.cause.source] ?? r.cause.source})` : ''
    return `${r.cause.path} = ${shown(r.cause.value)}${from}`
  }
  const v = r.trigger.outputs.value
  return v === undefined ? 'fired' : `value ${shown(v)}`
}

interface StepRowProps {
  step: FlowStep
  name: string
  onSelect: () => void
}

/** One block of a run: its branch with the condition's values, duration, writes, logs and errors. */
function StepRow({ step, name, onSelect }: StepRowProps) {
  const ms = stepDuration(step)
  return (
    <li data-sv-flow-step={step.blockId} className='py-[1px]'>
      <button
        type='button'
        title='Show this block'
        className='flex w-full items-baseline gap-1.5 text-left hover:underline'
        onClick={onSelect}
      >
        <span className='min-w-0 truncate text-[var(--text-primary)]'>{name}</span>
        {step.handle && (
          <span
            data-sv-flow-handle={step.handle}
            className='shrink-0'
            style={{ color: SV_HANDLE_COLOR[svHandleTone(step.handle)] }}
          >
            → {step.handle}
          </span>
        )}
        {step.eval && (
          <span className='min-w-0 truncate font-mono text-[var(--text-muted)]' data-sv-flow-eval>
            {evalText(step.eval)}
          </span>
        )}
        <span className='ml-auto shrink-0 text-[var(--text-muted)] tabular-nums'>
          {ms === null ? 'waiting…' : `${ms} ms`}
          {step.dropped ? ` · +${step.dropped} sampled` : ''}
        </span>
      </button>
      {step.writes.map((w, i) => (
        <p
          key={`w${i}`}
          data-sv-flow-write={w.path}
          className='pl-3 font-mono text-[var(--text-secondary)]'
        >
          writes {w.path} = {shown(w.value)}
        </p>
      ))}
      {step.values.map((v, i) => (
        <p key={`v${i}`} className='truncate pl-3 font-mono text-[var(--text-secondary)]'>
          {v.kind === 'log' ? 'logs' : 'publishes'} {v.text}
        </p>
      ))}
      {step.error && (
        <p className='pl-3 text-[var(--text-error)]'>
          {step.error.reason}
          {step.error.message ? `: ${step.error.message}` : ''}
        </p>
      )}
    </li>
  )
}
