'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button, ChipSwitch, toast } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { caseFromSimulatedRun, writablePaths } from '@/lib/sv/case-from-run'
import { explainFailures } from '@/lib/sv/fail-explain'
import type { FlowRun } from '@/lib/sv/flow-trace'
import type { Graph } from '@/lib/sv/test-generate'
import { FlowPanel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/flow-panel'
import {
  type TimelineKind,
  timelineRows,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { useCreateSvTestCase } from '@/hooks/queries/sv-test-cases'
import { usePanelEditorStore } from '@/stores/panel'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvTestStore } from '@/stores/sv/test/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const KIND_TONE: Record<TimelineKind, string> = {
  input: 'text-[var(--text-muted)]',
  write: 'text-[var(--text-primary)]',
  trigger: 'text-[var(--text-secondary)]',
  log: 'text-[var(--text-secondary)]',
  publish: 'text-[var(--text-secondary)]',
  error: 'text-[var(--text-error)]',
  cancel: 'text-[var(--warning)]',
}

/** A full replay takes about this long, whatever the virtual length. */
const REPLAY_MS = 5000

/**
 * Simulation timeline (M05-T10): inputs, triggers, writes, logs and publishes in virtual time, with
 * a replay cursor that drives the canvas overlay (TraceOverlay badges). The Flow view (M19-T04) shows the same
 * result as runs: picking one moves the replay to its start, replaying highlights the run at the cursor.
 */
export function SimulationTimeline() {
  const result = useSvSimulationStore((s) => s.result)
  const until = useSvSimulationStore((s) => s.until)
  const cursor = useSvSimulationStore((s) => s.cursor)
  const status = useSvSimulationStore((s) => s.status)
  const simulatedGraph = useSvSimulationStore((s) => s.graphJson)
  const currentGraph = useSvLintStore((s) => s.graphJson)
  const setCursor = useSvSimulationStore((s) => s.setCursor)
  const blocks = useWorkflowStore((s) => s.blocks)
  const workflowId = useSvSimulationStore((s) => s.workflowId)
  const scenario = useSvSimulationStore((s) => s.scenario)
  const create = useCreateSvTestCase(workflowId ?? undefined)
  const [playing, setPlaying] = useState(false)
  const [view, setView] = useState<'timeline' | 'flow'>('timeline')
  const frame = useRef<number | null>(null)
  const rows = useMemo(() => (result ? timelineRows(result) : []), [result])
  const inputs = useMemo(
    () =>
      (result?.signals ?? []).map((s) => ({
        path: s.path,
        ts: s.t,
        value: s.value,
        source: 'scenario',
      })),
    [result]
  )
  const graph = useMemo(
    () => (simulatedGraph ? (JSON.parse(simulatedGraph) as Graph) : null),
    [simulatedGraph]
  )
  // Why each unmet expectation failed (M19-T06): the decision that went the other way and the branch it needed.
  const failures = useMemo(
    () =>
      result?.expectations && !result.expectations.passed && scenario && graph
        ? explainFailures(scenario, result.trace, graph)
        : [],
    [result, scenario, graph]
  )
  const makeCase = (run: FlowRun) => {
    if (!result || !scenario || !graph) return
    const written = result.trace.flatMap((e) =>
      e.ev === 'write' && typeof e.data?.path === 'string'
        ? [{ ts: e.ts, path: e.data.path, value: e.data.value }]
        : []
    )
    const name = `${blocks[run.trigger.blockId]?.name ?? 'Run'} — run ${run.run}`.slice(0, 80)
    create.mutate(
      {
        name,
        scenario: caseFromSimulatedRun(scenario, run, written, writablePaths(graph.blocks), name),
      },
      {
        onSuccess: (c) => {
          useSvTestStore.getState().setActiveCase(c.id)
          toast.success(`Test case "${name}" added`)
        },
        onError: (e) => toast.error(`New case: ${e.message}`),
      }
    )
  }

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    const tick = (now: number) => {
      const next =
        useSvSimulationStore.getState().cursor + ((now - last) / REPLAY_MS) * Math.max(until, 1)
      last = now
      setCursor(next)
      if (next >= until) return setPlaying(false)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [playing, until, setCursor])

  if (status === 'running')
    return <p className='px-3 py-2 text-[var(--text-muted)] text-caption'>Simulating…</p>
  if (!result) {
    return (
      <p className='px-3 py-2 text-[var(--text-muted)] text-caption'>
        Press Simulate to run the scenario on a virtual clock.
      </p>
    )
  }
  const stale = simulatedGraph !== currentGraph
  const writes = result.writes.length
  return (
    <div
      className='flex min-h-0 flex-1 flex-col'
      data-sv='simulation-timeline'
      data-sv-stale={stale || undefined}
    >
      <div className='flex items-center gap-2 px-2 py-1'>
        <Button
          size='sm'
          variant='ghost'
          aria-label={playing ? 'Pause replay' : 'Replay'}
          onClick={() => {
            if (!playing && cursor >= until) setCursor(0)
            setPlaying(!playing)
          }}
        >
          {playing ? <Pause className='size-[14px]' /> : <Play className='size-[14px]' />}
        </Button>
        <input
          type='range'
          aria-label='Replay time'
          min={0}
          max={until}
          value={Math.round(cursor)}
          onChange={(e) => {
            setPlaying(false)
            setCursor(Number(e.target.value))
          }}
          className='min-w-0 flex-1'
        />
        <span
          className='w-[96px] text-right text-[var(--text-muted)] text-caption tabular-nums'
          data-sv='sim-cursor'
        >
          {Math.round(cursor)} / {until} ms
        </span>
        <ChipSwitch
          aria-label='Show'
          value={view}
          onChange={(v) => setView(v as typeof view)}
          options={[
            { label: 'Timeline', value: 'timeline' },
            { label: 'Flow', value: 'flow' },
          ]}
        />
      </div>
      <p className='px-3 text-[var(--text-muted)] text-caption' aria-live='polite'>
        {stale
          ? 'The workflow changed since this simulation — Simulate again'
          : `${writes} write${writes === 1 ? '' : 's'}${result.expectations ? (result.expectations.passed ? ' · expectations met' : ` · ${result.expectations.mismatches.length} expectation(s) not met`) : ''}`}
      </p>
      {!stale && failures.length > 0 && (
        <ul
          data-sv='fail-explain'
          aria-label='Why the case failed'
          className='mx-2 my-1 rounded-md border border-[var(--border)] px-2 py-1 text-caption'
        >
          {failures.map((f, i) => (
            <li key={`${f.expected}-${i}`} data-sv-fail-block={f.blockId}>
              <button
                type='button'
                className='text-left hover:underline'
                disabled={!f.blockId}
                onClick={() =>
                  f.blockId && usePanelEditorStore.getState().setCurrentBlockId(f.blockId)
                }
              >
                <span className='text-[var(--text-error)]'>Expected {f.expected}</span>
                <span className='text-[var(--text-secondary)]'> — {f.why}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {view === 'flow' ? (
        <FlowPanel
          trace={result.trace}
          signals={inputs}
          blockName={(id) => blocks[id]?.name}
          onSelectBlock={(id) => usePanelEditorStore.getState().setCurrentBlockId(id)}
          activeAt={cursor}
          onPickRun={(r) => {
            setPlaying(false)
            setCursor(r.startedAt)
          }}
          onMakeCase={scenario && workflowId ? makeCase : undefined}
          emptyText='No trigger fired in this simulation — add an input that changes a watched signal'
          downloadName='flow-simulation.jsonl'
        />
      ) : (
        <ul className='min-h-0 flex-1 overflow-y-auto px-1 font-mono text-caption'>
          {rows.map((r, i) => (
            <li
              key={`${r.t}-${i}`}
              data-sv-sim-row={r.kind}
              className={cn(
                'flex gap-2 px-2 py-[1px]',
                r.t > cursor && 'opacity-40',
                KIND_TONE[r.kind]
              )}
            >
              <span className='w-[64px] shrink-0 text-right tabular-nums'>{r.t}</span>
              <span className='w-[64px] shrink-0'>{r.kind}</span>
              <span className='min-w-0 flex-1 truncate'>
                {r.label} {r.detail && <span className='text-[var(--text-muted)]'>{r.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
