'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button, ChipInput, ChipTextarea } from '@/components/emcn'
import type { SvScenario, SvTestCase } from '@/lib/api/contracts/sv'
import {
  defaultScenario,
  formatCell,
  parseCell,
  scenarioFromYaml,
  scenarioToYaml,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { svScenarioKeys, useSaveSvScenario, useSvScenario } from '@/hooks/queries/sv-simulation'
import { useUpdateSvTestCase } from '@/hooks/queries/sv-test-cases'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

interface ScenarioEditorProps {
  workflowId: string
  workflowName: string
  /** The test case to edit (Test tab, ADR-0058); without it, the workflow's first case (`/scenario`). */
  testCase?: SvTestCase
}

/** Edits are saved this long after the last keystroke. */
const SAVE_DEBOUNCE_MS = 500

type Input = SvScenario['inputs'][number]
const targetOf = (i: Input) => ('path' in i ? i.path : `mqtt:${i.topic}`)
const withTarget = (i: Input, target: string): Input =>
  target.startsWith('mqtt:')
    ? { t: i.t, topic: target.slice(5), value: i.value }
    : { t: i.t, path: target, value: i.value }

/**
 * Scenario editor (M05-T09, ADR-0017 §3): initial values, inputs over virtual time (a VSS path or
 * `mqtt:<topic>`), run length; YAML view to import/export the contracts `scenario` v1 format.
 */
export function ScenarioEditor({ workflowId, workflowName, testCase }: ScenarioEditorProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<SvScenario | null>(null)
  const queryClient = useQueryClient()
  const first = useSvScenario(testCase ? undefined : workflowId)
  const saved = testCase ? testCase.scenario : first.data
  const isLoading = !testCase && first.isLoading
  const saveFirst = useSaveSvScenario(workflowId)
  const updateCase = useUpdateSvTestCase(workflowId)
  const caseId = testCase?.id
  const save = {
    mutate: (next: SvScenario) =>
      caseId ? updateCase.mutate({ caseId, scenario: next }) : saveFirst.mutate(next),
  }
  const draft = useSvSimulationStore((s) =>
    s.draft?.workflowId === workflowId && s.draft.caseId === caseId ? s.draft.scenario : null
  )
  const setDraft = useSvSimulationStore((s) => s.setDraft)
  const [yamlText, setYamlText] = useState<string | null>(null)
  const [yamlError, setYamlError] = useState<string | null>(null)

  const scenario = useMemo(
    () => draft ?? saved ?? defaultScenario(workflowName),
    [draft, saved, workflowName]
  )

  /** Saves the pending edit now; skipped when it is already what is saved (Simulate saves too). */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    const current = caseId ? saved : queryClient.getQueryData(svScenarioKeys.detail(workflowId))
    if (next && current !== next) save.mutate(next)
  }, [queryClient, save, workflowId, caseId, saved])
  const flushRef = useRef(flush)
  flushRef.current = flush

  const update = useCallback(
    (next: SvScenario) => {
      setDraft(workflowId, next, caseId)
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS)
    },
    [setDraft, workflowId, caseId]
  )

  // An edit is never dropped: leaving the tab or the page saves it right away.
  useEffect(() => {
    const onPageHide = () => flushRef.current()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      flushRef.current()
    }
  }, [])

  const setInput = (index: number, input: Input) =>
    update({ ...scenario, inputs: scenario.inputs.map((x, i) => (i === index ? input : x)) })
  const initial = Object.entries(scenario.initial ?? {})
  const setInitial = (rows: [string, unknown][]) =>
    update({ ...scenario, initial: Object.fromEntries(rows) as SvScenario['initial'] })

  if (isLoading)
    return <p className='px-3 py-2 text-[var(--text-muted)] text-caption'>Loading scenario…</p>

  if (yamlText !== null) {
    return (
      <div className='flex min-h-0 flex-1 flex-col gap-2 p-2' data-sv='scenario-yaml'>
        <ChipTextarea
          aria-label='Scenario YAML'
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          error={Boolean(yamlError)}
          className='min-h-0 flex-1 font-mono'
        />
        {yamlError && <p className='text-[var(--text-error)] text-caption'>{yamlError}</p>}
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='active'
            onClick={() => {
              const parsed = scenarioFromYaml(yamlText)
              if (!parsed.ok) return setYamlError(parsed.error)
              update(parsed.scenario)
              setYamlText(null)
              setYamlError(null)
            }}
          >
            Apply
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => {
              setYamlText(null)
              setYamlError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2'
      data-sv='scenario-editor'
    >
      <div className='flex items-center gap-2'>
        <span className='text-[var(--text-muted)] text-caption'>Run for</span>
        <ChipInput
          aria-label='Run length (ms)'
          type='number'
          min={0}
          max={86_400_000}
          value={scenario.until}
          onChange={(e) =>
            update({
              ...scenario,
              until: Math.max(0, Math.min(86_400_000, Number(e.target.value) || 0)),
            })
          }
          className='w-[110px]'
        />
        <span className='text-[var(--text-muted)] text-caption'>ms</span>
        <Button
          size='sm'
          variant='ghost'
          className='ml-auto'
          onClick={() => setYamlText(scenarioToYaml(scenario))}
        >
          YAML
        </Button>
      </div>

      <p className='text-[var(--text-muted)] text-caption'>Initial values</p>
      {initial.map(([path, value], i) => (
        <div key={`init-${i}`} className='flex items-center gap-1' data-sv='scenario-initial-row'>
          <ChipInput
            aria-label='Initial signal'
            value={path}
            placeholder='Vehicle.Speed'
            onChange={(e) =>
              setInitial(initial.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))
            }
            className='min-w-0 flex-1'
          />
          <ChipInput
            aria-label='Initial value'
            value={formatCell(value)}
            onChange={(e) =>
              setInitial(initial.map((r, j) => (j === i ? [r[0], parseCell(e.target.value)] : r)))
            }
            className='w-[90px]'
          />
          <Button
            size='sm'
            variant='ghost'
            aria-label='Remove initial value'
            onClick={() => setInitial(initial.filter((_, j) => j !== i))}
          >
            <Trash2 className='size-[14px]' />
          </Button>
        </div>
      ))}
      <Button
        size='sm'
        variant='ghost'
        className='self-start'
        onClick={() => setInitial([...initial, ['', 0]])}
      >
        <Plus className='size-[14px]' /> Initial value
      </Button>

      <p className='text-[var(--text-muted)] text-caption'>
        Inputs (time ms · signal or mqtt:topic · value)
      </p>
      {scenario.inputs.map((input, i) => (
        <div key={`in-${i}`} className='flex items-center gap-1' data-sv='scenario-input-row'>
          <ChipInput
            aria-label='Input time (ms)'
            type='number'
            min={0}
            value={input.t}
            onChange={(e) => setInput(i, { ...input, t: Math.max(0, Number(e.target.value) || 0) })}
            className='w-[80px]'
          />
          <ChipInput
            aria-label='Input signal'
            value={targetOf(input)}
            placeholder='Vehicle.Speed'
            onChange={(e) => setInput(i, withTarget(input, e.target.value))}
            className='min-w-0 flex-1'
          />
          <ChipInput
            aria-label='Input value'
            value={formatCell(input.value)}
            onChange={(e) => setInput(i, { ...input, value: parseCell(e.target.value) })}
            className='w-[90px]'
          />
          <Button
            size='sm'
            variant='ghost'
            aria-label='Remove input'
            onClick={() =>
              update({ ...scenario, inputs: scenario.inputs.filter((_, j) => j !== i) })
            }
          >
            <Trash2 className='size-[14px]' />
          </Button>
        </div>
      ))}
      <Button
        size='sm'
        variant='ghost'
        className='self-start'
        onClick={() => {
          const last = scenario.inputs[scenario.inputs.length - 1]
          update({
            ...scenario,
            inputs: [
              ...scenario.inputs,
              {
                t: last ? last.t + 1000 : 1000,
                path: last && 'path' in last ? last.path : 'Vehicle.Speed',
                value: 0,
              },
            ],
          })
        }}
      >
        <Plus className='size-[14px]' /> Input
      </Button>

      <ExpectationsEditor scenario={scenario} onChange={update} />
    </div>
  )
}

type Expect = NonNullable<SvScenario['expect']>
type ExpectedWrite = NonNullable<Expect['writes']>[number]

/** Scenario 1.1 when a case uses `within` or `never` (ADR-0058 §9); otherwise its version is kept. */
function withExpect(scenario: SvScenario, expect: Expect): SvScenario {
  const uses11 = Boolean(expect.never?.length || expect.writes?.some((w) => w.within !== undefined))
  const empty =
    !expect.writes?.length &&
    !expect.never?.length &&
    !expect.publishes?.length &&
    !expect.trace?.length
  const { expect: _old, ...rest } = scenario
  return {
    ...rest,
    scenarioVersion: uses11 ? '1.1.0' : scenario.scenarioVersion,
    ...(empty ? {} : { expect }),
  }
}

interface ExpectationsEditorProps {
  scenario: SvScenario
  onChange: (next: SvScenario) => void
}

/**
 * Then (ADR-0058 §4): the writes the case expects — at a time, within a tolerance — and the signals it must never
 * write. Publishes and trace matchers are kept as they are (YAML view).
 */
function ExpectationsEditor({ scenario, onChange }: ExpectationsEditorProps) {
  const expect = scenario.expect ?? {}
  const writes = expect.writes ?? []
  const never = expect.never ?? []
  const setWrites = (next: ExpectedWrite[]) =>
    onChange(withExpect(scenario, { ...expect, writes: next }))
  const setNever = (next: NonNullable<Expect['never']>) =>
    onChange(withExpect(scenario, { ...expect, never: next }))
  return (
    <div className='flex flex-col gap-2' data-sv='scenario-expect'>
      <p className='text-[var(--text-muted)] text-caption'>
        Then: expected writes (time ms · signal · value · within ms)
      </p>
      {writes.map((w, i) => (
        <div key={`w-${i}`} className='flex items-center gap-1' data-sv='scenario-expect-row'>
          <ChipInput
            aria-label='Expected time (ms)'
            type='number'
            min={0}
            value={w.t}
            onChange={(e) =>
              setWrites(
                writes.map((x, j) =>
                  j === i ? { ...x, t: Math.max(0, Number(e.target.value) || 0) } : x
                )
              )
            }
            className='w-[80px]'
          />
          <ChipInput
            aria-label='Expected signal'
            value={w.path}
            placeholder='Vehicle.Body.Lights.Hazard.IsSignaling'
            onChange={(e) =>
              setWrites(writes.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))
            }
            className='min-w-0 flex-1'
          />
          <ChipInput
            aria-label='Expected value'
            value={formatCell(w.value)}
            onChange={(e) =>
              setWrites(
                writes.map((x, j) => (j === i ? { ...x, value: parseCell(e.target.value) } : x))
              )
            }
            className='w-[80px]'
          />
          <ChipInput
            aria-label='Within (ms)'
            type='number'
            min={0}
            placeholder='0'
            value={w.within ?? ''}
            onChange={(e) =>
              setWrites(
                writes.map((x, j) => {
                  if (j !== i) return x
                  const { within: _w, ...rest } = x
                  return e.target.value === ''
                    ? rest
                    : {
                        ...rest,
                        within: Math.max(0, Math.min(60_000, Number(e.target.value) || 0)),
                      }
                })
              )
            }
            className='w-[70px]'
          />
          <Button
            size='sm'
            variant='ghost'
            aria-label='Remove expected write'
            onClick={() => setWrites(writes.filter((_, j) => j !== i))}
          >
            <Trash2 className='size-[14px]' />
          </Button>
        </div>
      ))}
      <Button
        size='sm'
        variant='ghost'
        className='self-start'
        onClick={() =>
          setWrites([
            ...writes,
            { t: scenario.until, path: writes[writes.length - 1]?.path ?? '', value: true },
          ])
        }
      >
        <Plus className='size-[14px]' /> Expected write
      </Button>
      <p className='text-[var(--text-muted)] text-caption'>Then: never written (signal)</p>
      {never.map((n, i) => (
        <div key={`n-${i}`} className='flex items-center gap-1' data-sv='scenario-never-row'>
          <ChipInput
            aria-label='Never written signal'
            value={n.path}
            onChange={(e) =>
              setNever(never.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)))
            }
            className='min-w-0 flex-1'
          />
          <Button
            size='sm'
            variant='ghost'
            aria-label='Remove never'
            onClick={() => setNever(never.filter((_, j) => j !== i))}
          >
            <Trash2 className='size-[14px]' />
          </Button>
        </div>
      ))}
      <Button
        size='sm'
        variant='ghost'
        className='self-start'
        onClick={() => setNever([...never, { path: '' }])}
      >
        <Plus className='size-[14px]' /> Never written
      </Button>
    </div>
  )
}
