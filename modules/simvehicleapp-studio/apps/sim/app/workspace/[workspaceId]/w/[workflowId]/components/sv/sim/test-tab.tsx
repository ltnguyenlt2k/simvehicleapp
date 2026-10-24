'use client'

import { useEffect, useMemo, useState } from 'react'
import { sleep } from '@sim/utils/helpers'
import {
  Check,
  Copy,
  FlaskConical,
  Minus,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { Button, ChipInput, toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvScenario,
  type SvTestCase,
  svPlaybackStatusContract,
  svPlayScenarioContract,
  svSimulateContract,
} from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { gradePlayback, observedPaths } from '@/lib/sv/expectations'
import {
  branchCoverage,
  type Graph,
  generateTests,
  lockExpectations,
  writablePaths,
} from '@/lib/sv/test-generate'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { ScenarioEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-editor'
import { defaultScenario } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { SimulationTimeline } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/simulation-timeline'
import {
  useCreateSvTestCase,
  useDeleteSvTestCase,
  useSvTestCases,
  useUpdateSvTestCase,
} from '@/hooks/queries/sv-test-cases'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { type SvCaseOutcome, useSvTestStore } from '@/stores/sv/test/store'

interface TestTabProps {
  workflowId: string
  workflowName: string
  /** Opens the assistant with a request written for it (empty state). */
  onAskAssistant?: (text: string) => void
  /** Opens the Signals tab to record a live run (empty state). */
  onRecord?: () => void
}

/** Ask the assistant: the request the empty state writes for it (ADR-0058 §8). */
export const ASK_FOR_TESTS =
  'Test this workflow: propose test cases that cover its branches (both sides of each condition), then simulate them.'

/** Simulates one case on the canvas graph: its outcome (expectations, blocks entered) and the raw result. */
async function simulateCase(graphJson: string, scenario: SvScenario) {
  const response = await requestJson(svSimulateContract, {
    body: { graph: JSON.parse(graphJson) as Record<string, unknown>, scenario },
  })
  const result = response.result
  if (!result) return { outcome: null, result: null, diagnostics: response.diagnostics }
  const blockIds = [
    ...new Set(result.trace.flatMap((e) => (e.ev === 'enter' && e.blockId ? [e.blockId] : []))),
  ]
  const outcome: SvCaseOutcome = {
    passed: result.expectations ? result.expectations.passed : true,
    mismatches: result.expectations?.mismatches ?? [],
    graphJson,
    blockIds,
  }
  return { outcome, result, diagnostics: response.diagnostics }
}

/**
 * Test tab (ADR-0058 §4, M18-T04): the workflow's test cases — add, rename, duplicate, delete — the editor of the
 * active one (Given / When / Then, YAML), Simulate for one or all with pass/fail per case, Generate tests from the
 * graph with branch coverage, and a guided empty state.
 */
export function TestTab({ workflowId, workflowName, onAskAssistant, onRecord }: TestTabProps) {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const { data: cases, isLoading } = useSvTestCases(workflowId)
  const create = useCreateSvTestCase(workflowId)
  const update = useUpdateSvTestCase(workflowId)
  const remove = useDeleteSvTestCase(workflowId)
  const activeCaseId = useSvTestStore((s) => s.activeCaseId)
  const outcomes = useSvTestStore((s) => s.outcomes)
  const [busy, setBusy] = useState<null | 'all' | 'generate' | 'play'>(null)
  const { project, active: run } = useWorkflowRuns()
  const running = run?.state === 'running'
  const [renaming, setRenaming] = useState<string | null>(null)

  useEffect(() => {
    useSvTestStore.getState().open(workflowId)
  }, [workflowId])

  const active = cases?.find((c) => c.id === activeCaseId) ?? cases?.[0]
  // Simulate (action bar) runs the case the editor shows. The first case is the workflow's scenario: its editor keeps
  // its own draft (no case id), so a refetch never replaces an edit in progress.
  const firstId = cases?.[0]?.id
  const onFirst = !active || active.id === firstId
  useEffect(() => {
    const sim = useSvSimulationStore.getState()
    if (active && active.id !== firstId) {
      if (sim.draft?.workflowId !== workflowId || sim.draft.caseId !== active.id) {
        sim.setDraft(workflowId, active.scenario, active.id)
      }
    } else if (active && sim.draft?.workflowId === workflowId && sim.draft.caseId) {
      sim.setDraft(workflowId, active.scenario)
    }
  }, [active, firstId, workflowId])

  const graph = useMemo(() => (graphJson ? (JSON.parse(graphJson) as Graph) : null), [graphJson])
  const fresh = (o: SvCaseOutcome | undefined) => (o && o.graphJson === graphJson ? o : undefined)
  const coverage = useMemo(() => {
    if (!graph || !cases?.length) return null
    const entered = cases.flatMap((c) => {
      const o = outcomes[c.id]
      return o && o.graphJson === graphJson ? o.blockIds : []
    })
    const { covered, missing } = branchCoverage(graph, entered)
    const total = covered.length + missing.length
    return total ? { covered: covered.length, total, missing } : null
  }, [graph, cases, outcomes, graphJson])

  const select = (c: SvTestCase) => useSvTestStore.getState().setActiveCase(c.id)

  const newCase = (name: string, scenario: SvScenario) =>
    create.mutate(
      { name, scenario },
      {
        onSuccess: (c) => useSvTestStore.getState().setActiveCase(c.id),
        onError: (e) => toast.error(`New case: ${e.message}`),
      }
    )

  const simulateAll = async () => {
    if (!graphJson || !cases?.length) return
    setBusy('all')
    let failed = 0
    try {
      for (const c of cases) {
        const { outcome, diagnostics } = await simulateCase(graphJson, c.scenario)
        if (!outcome) {
          const errors = diagnostics.filter((d) => d.severity === 'error').length
          toast.error(`Simulate: fix ${errors} error${errors === 1 ? '' : 's'} first (Problems)`)
          return
        }
        useSvTestStore.getState().setOutcome(c.id, outcome)
        if (!outcome.passed) failed++
      }
      if (failed) toast.error(`${failed} of ${cases.length} test cases failed`)
      else toast.success(`All ${cases.length} test cases passed`)
    } catch (e) {
      toast.error(`Simulate: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    if (!graphJson || !graph) return
    const generated = generateTests(graph)
    if (!generated.length) {
      toast.error('No test to generate: the workflow has no signal or app-start trigger')
      return
    }
    setBusy('generate')
    const actuators = writablePaths(graph)
    let added = 0
    try {
      for (const g of generated) {
        const { result } = await simulateCase(graphJson, g.scenario)
        if (!result) {
          toast.error('Generate tests: the workflow does not compile yet (Problems)')
          return
        }
        await create.mutateAsync({
          name: g.name.slice(0, 80),
          scenario: lockExpectations(g.scenario, result, actuators),
        })
        added++
      }
      toast.success(
        `${added} test cases added. They lock what the workflow does now: check each one before you rely on it.`
      )
    } catch (e) {
      toast.error(`Generate tests: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  /**
   * Play on the vehicle stack (ADR-0058 §4): the active case's inputs go to the running app's databroker, and what the
   * app writes is graded with a 300 ms tolerance; the lag is reported.
   */
  const playOnVehicle = async () => {
    if (!project || !running || !active) return
    setBusy('play')
    try {
      const sc = active.scenario
      const started = await requestJson(svPlayScenarioContract, {
        params: { id: project.id },
        body: { scenario: sc, observe: observedPaths(sc) },
      })
      const deadline = Date.now() + sc.until + 15_000
      let pb = started
      while (pb.state === 'playing' && Date.now() < deadline) {
        await sleep(500)
        pb = await requestJson(svPlaybackStatusContract, { params: { id: project.id } })
      }
      // The app's last writes land a moment after the last input.
      await sleep(1500)
      pb = await requestJson(svPlaybackStatusContract, { params: { id: project.id } })
      const grade = gradePlayback(sc, pb)
      const lag = grade.drifts.length ? Math.max(...grade.drifts) : null
      useSvTestStore.getState().setOutcome(active.id, {
        passed: grade.passed,
        mismatches: [
          ...grade.mismatches,
          ...(lag !== null ? [`played on the vehicle: lag up to ${lag} ms`] : []),
        ],
        graphJson: graphJson ?? '',
        blockIds: [],
      })
      if (grade.passed)
        toast.success(
          `${active.name}: passed on the vehicle${lag !== null ? ` (lag up to ${lag} ms)` : ''}`
        )
      else
        toast.error(
          `${active.name}: ${grade.mismatches.length} expectation(s) not met on the vehicle`
        )
    } catch (e) {
      toast.error(`Play on the vehicle: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  if (isLoading)
    return <p className='px-3 py-2 text-[var(--text-muted)] text-caption'>Loading test cases…</p>

  return (
    <div className='flex min-h-0 flex-1' data-sv='test-tab'>
      <div className='flex w-[260px] min-w-0 shrink-0 flex-col border-[var(--border)] border-r'>
        {!cases?.length ? (
          // No case yet: a guided start; the editor next to it writes the first case ("Default").
          <div className='flex flex-col items-start gap-2 px-3 py-2' data-sv='test-empty'>
            <p className='text-[var(--text-secondary)] text-caption'>
              No test case yet: give the workflow inputs over time (When) and say what it must do
              (Then). SynCode turns every case into a test of the vehicle app.
            </p>
            <Button
              size='sm'
              variant='primary'
              disabled={!graphJson || busy !== null}
              onClick={() => void generate()}
              data-sv='test-generate'
            >
              <Wand2 className='size-[14px]' />{' '}
              {busy === 'generate' ? 'Generating…' : 'Generate tests'}
            </Button>
            {onAskAssistant && (
              <Button
                size='sm'
                variant='ghost'
                onClick={() => onAskAssistant(ASK_FOR_TESTS)}
                data-sv='test-ask'
              >
                <Sparkles className='size-[14px]' /> Ask the assistant
              </Button>
            )}
            {onRecord && (
              <Button size='sm' variant='ghost' onClick={onRecord} data-sv='test-record'>
                Record from a live run
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className='flex flex-wrap items-center gap-1 px-2 py-1'>
              <Button
                size='sm'
                variant='ghost'
                onClick={() =>
                  newCase(`Case ${(cases?.length ?? 0) + 1}`, defaultScenario(workflowName))
                }
                data-sv='test-new'
                title='New test case'
              >
                <Plus className='size-[14px]' />
              </Button>
              <Button
                size='sm'
                variant='ghost'
                disabled={!graphJson || busy !== null}
                onClick={() => void generate()}
                data-sv='test-generate'
                title='Generate tests from the workflow'
              >
                <Wand2 className='size-[14px]' /> {busy === 'generate' ? 'Generating…' : 'Generate'}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                disabled={!graphJson || busy !== null}
                onClick={() => void simulateAll()}
                data-sv='test-simulate-all'
                title='Simulate every case'
              >
                <FlaskConical className='size-[14px]' />{' '}
                {busy === 'all' ? 'Simulating…' : 'Simulate all'}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                disabled={!running || !active || busy !== null}
                onClick={() => void playOnVehicle()}
                data-sv='test-play'
                title={
                  running
                    ? 'Play the selected case on the running app and check it'
                    : 'Run the app to play a case on the vehicle stack'
                }
              >
                <Play className='size-[14px]' /> {busy === 'play' ? 'Playing…' : 'Play on vehicle'}
              </Button>
            </div>
            {coverage && (
              <p
                className='px-3 pb-1 text-[var(--text-muted)] text-caption'
                data-sv='test-coverage'
                title={coverage.missing.map((b) => `${b.from} → ${b.handle}`).join(', ')}
              >
                Branches covered: {coverage.covered} / {coverage.total}
              </p>
            )}
            <ul className='min-h-0 flex-1 overflow-y-auto px-1' aria-label='Test cases'>
              {cases.map((c) => {
                const o = fresh(outcomes[c.id])
                const Icon = !o ? Minus : o.passed ? Check : X
                return (
                  <li
                    key={c.id}
                    data-sv='test-case'
                    data-sv-case={c.id}
                    data-sv-outcome={!o ? 'none' : o.passed ? 'passed' : 'failed'}
                    className={cn(
                      'group flex items-center gap-1 rounded-md px-1.5 py-1 text-small',
                      c.id === active?.id && 'bg-[var(--surface-active)]'
                    )}
                    title={o?.mismatches.join('\n')}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        'size-[12px] shrink-0',
                        o?.passed && 'text-[var(--text-success)]',
                        o && !o.passed && 'text-[var(--text-error)]',
                        !o && 'text-[var(--text-muted)]'
                      )}
                    />
                    {renaming === c.id ? (
                      <ChipInput
                        aria-label='Test case name'
                        defaultValue={c.name}
                        autoFocus
                        maxLength={80}
                        onBlur={(e) => {
                          const name = e.target.value.trim()
                          if (name && name !== c.name) update.mutate({ caseId: c.id, name })
                          setRenaming(null)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                        className='min-w-0 flex-1'
                      />
                    ) : (
                      <button
                        type='button'
                        className='min-w-0 flex-1 truncate text-left text-[var(--text-primary)]'
                        onClick={() => select(c)}
                        onDoubleClick={() => setRenaming(c.id)}
                      >
                        {c.name}
                      </button>
                    )}
                    <Button
                      size='sm'
                      variant='ghost'
                      aria-label={`Duplicate ${c.name}`}
                      className='opacity-0 group-hover:opacity-100'
                      onClick={() => newCase(`${c.name} (copy)`.slice(0, 80), c.scenario)}
                    >
                      <Copy className='size-[12px]' />
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      aria-label={`Delete ${c.name}`}
                      className='opacity-0 group-hover:opacity-100'
                      onClick={() =>
                        remove.mutate(c.id, {
                          onSuccess: () => useSvTestStore.getState().forget(c.id),
                          onError: (e) => toast.error(`Delete: ${e.message}`),
                        })
                      }
                    >
                      <Trash2 className='size-[12px]' />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
      <div className='flex w-[440px] min-w-0 shrink-0 flex-col border-[var(--border)] border-r'>
        {onFirst || !active ? (
          <ScenarioEditor key='first' workflowId={workflowId} workflowName={workflowName} />
        ) : (
          <ScenarioEditor
            key={active.id}
            workflowId={workflowId}
            workflowName={workflowName}
            testCase={active}
          />
        )}
      </div>
      <SimulationTimeline />
    </div>
  )
}
