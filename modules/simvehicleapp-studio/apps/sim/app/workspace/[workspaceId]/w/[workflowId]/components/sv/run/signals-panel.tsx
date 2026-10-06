'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ChipInput, ChipSelect, toast } from '@/components/emcn'
import { type SvSignalField, svSignalUpdateSchema } from '@/lib/api/contracts/sv'
import {
  applySignalUpdates,
  graphSignalPaths,
  parseSignalInput,
  type Recording,
  recordingToScenario,
  type SignalValues,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-model'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { usePlaySvScenario, useSetSvSignal } from '@/hooks/queries/sv-runs'
import { useSaveSvScenario, useSvScenario } from '@/hooks/queries/sv-simulation'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

const PATH = /^Vehicle(\.[A-Za-z0-9_]+)+$/
const shown = (v: SignalValues['value']) =>
  v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v)

interface SignalRowProps {
  projectId: string
  path: string
  values?: SignalValues
  onInjected: (
    path: string,
    value: ReturnType<typeof parseSignalInput>,
    field: SvSignalField
  ) => void
  onRemove?: () => void
}

function SignalRow({ projectId, path, values, onInjected, onRemove }: SignalRowProps) {
  const [text, setText] = useState('')
  const [field, setField] = useState<SvSignalField>('value')
  const set = useSetSvSignal()
  const inject = () => {
    const value = parseSignalInput(text)
    set.mutate(
      { projectId, path, value, field },
      {
        onSuccess: () => onInjected(path, value, field),
        onError: (e) => toast.error(e.message),
      }
    )
  }
  return (
    <tr data-sv-signal={path} className='border-[var(--border)] border-b'>
      <td className='truncate py-0.5 pr-2 font-mono text-[11px]' title={path}>
        {path}
      </td>
      <td className='px-2 font-mono text-[11px]' data-sv-signal-value>
        {shown(values?.value)}
      </td>
      <td className='px-2 font-mono text-[11px]' data-sv-signal-target>
        {shown(values?.target)}
      </td>
      <td className='px-2'>
        <div className='flex items-center gap-1'>
          <ChipInput
            aria-label={`Value for ${path}`}
            value={text}
            placeholder='130, true, SLOW…'
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && text.trim() && inject()}
            className='w-[120px]'
          />
          <ChipSelect
            aria-label={`Field for ${path}`}
            value={field}
            onChange={(v) => setField(v as SvSignalField)}
            options={[
              { label: 'value', value: 'value' },
              { label: 'target', value: 'target' },
            ]}
          />
          <Button
            variant='ghost'
            size='sm'
            data-sv-inject={path}
            disabled={!text.trim() || set.isPending}
            onClick={inject}
          >
            Set
          </Button>
          {onRemove && (
            <Button
              variant='ghost'
              size='sm'
              onClick={onRemove}
              aria-label={`Stop watching ${path}`}
            >
              ×
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

/**
 * Signals panel (M08-T08/T09): current value and actuator target of the watched signals on the
 * databroker of the project's VSS release (live), inject, record injections as the workflow's
 * scenario, and play the saved scenario on the databroker (M08-T07).
 */
export function SignalsPanel() {
  const { project } = useWorkflowRuns()
  const workflowId = useSvLintStore((s) => s.workflowId)
  const graphJson = useSvLintStore((s) => s.graphJson)
  const fromGraph = useMemo(() => graphSignalPaths(graphJson), [graphJson])
  const [extra, setExtra] = useState<string[]>([])
  const [adding, setAdding] = useState('')
  const [values, setValues] = useState<Record<string, SignalValues>>({})
  const [recording, setRecording] = useState<Recording | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const { data: scenario } = useSvScenario(workflowId ?? undefined)
  const save = useSaveSvScenario(workflowId ?? undefined)
  const play = usePlaySvScenario()
  const paths = useMemo(() => [...new Set([...fromGraph, ...extra])], [fromGraph, extra])
  const key = paths.join(',')
  const projectId = project?.id

  useEffect(() => {
    recordingRef.current = recording
  }, [recording])

  useEffect(() => {
    if (!projectId || !key) return
    const source = new EventSource(
      `/api/sv/projects/${encodeURIComponent(projectId)}/signals?paths=${encodeURIComponent(key)}`
    )
    source.addEventListener('signal', (e) => {
      const v = svSignalUpdateSchema.safeParse(JSON.parse((e as MessageEvent<string>).data))
      if (v.success) setValues((prev) => applySignalUpdates(prev, [v.data]))
    })
    return () => source.close()
  }, [projectId, key])

  if (!project) {
    return (
      <div className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'>
        Add this workflow to a vehicle project to watch and inject its signals
      </div>
    )
  }

  const onInjected = (
    path: string,
    value: ReturnType<typeof parseSignalInput>,
    field: SvSignalField
  ) => {
    const rec = recordingRef.current
    if (rec && field === 'value') {
      setRecording({
        ...rec,
        inputs: [...rec.inputs, { t: Date.now() - rec.startedAt, path, value }],
      })
    }
  }
  const startRecording = () => {
    const initial: Recording['initial'] = {}
    for (const p of paths) if (values[p]?.value !== undefined) initial[p] = values[p].value as never
    setRecording({ startedAt: Date.now(), initial, inputs: [] })
  }
  const saveRecording = () => {
    if (!recording) return
    const s = recordingToScenario(
      recording,
      `Recorded ${new Date(recording.startedAt).toLocaleTimeString()}`
    )
    save.mutate(s, {
      onSuccess: () => {
        toast.success(
          `Saved as the workflow's scenario (${s.inputs.length} inputs) — open in Simulation`
        )
        setRecording(null)
        useSvSimulationStore.getState().showSimulation()
      },
      onError: (e) => toast.error(e.message),
    })
  }
  const playSaved = () => {
    if (!scenario) return
    play.mutate(
      { projectId: project.id, scenario },
      {
        onSuccess: (p) =>
          toast.success(
            `Playing "${p.name}" on the vehicle stack (${p.total} values, ${p.until} ms)`
          ),
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <div data-sv='signals' className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b px-2 py-1'>
        <span className='text-[12px] text-[var(--text-secondary)]'>{`VSS ${project.vssRelease}`}</span>
        <ChipInput
          aria-label='Watch a signal'
          placeholder='Vehicle.Cabin.…'
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const p = adding.trim()
            if (!PATH.test(p)) return toast.error('A VSS path like Vehicle.Speed')
            setExtra((x) => (x.includes(p) ? x : [...x, p]))
            setAdding('')
          }}
          className='w-[260px]'
        />
        <div className='ml-auto flex items-center gap-1'>
          {recording ? (
            <>
              <span data-sv='recording' className='text-[12px] text-[var(--text-error)]'>
                {`● Recording · ${recording.inputs.length} input${recording.inputs.length === 1 ? '' : 's'}`}
              </span>
              <Button variant='ghost' size='sm' onClick={() => setRecording(null)}>
                Discard
              </Button>
              <Button
                variant='primary'
                size='sm'
                data-sv='save-recording'
                disabled={!recording.inputs.length || save.isPending}
                onClick={saveRecording}
              >
                Save as scenario
              </Button>
            </>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              data-sv='record'
              onClick={startRecording}
              title='Record injected values as the workflow scenario (Simulate)'
            >
              Record
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            data-sv='play-scenario'
            disabled={!scenario || play.isPending}
            onClick={playSaved}
            title={
              scenario
                ? `Play "${scenario.name}" on the vehicle stack`
                : 'No saved scenario (Simulation tab)'
            }
          >
            Play scenario
          </Button>
        </div>
      </div>
      <div className='min-h-0 flex-1 overflow-auto px-2'>
        <table className='w-full table-fixed text-left text-[12px]'>
          <thead className='text-[11px] text-[var(--text-muted)]'>
            <tr>
              <th className='w-[38%] py-1 font-normal'>Signal</th>
              <th className='w-[12%] px-2 font-normal'>Current</th>
              <th className='w-[12%] px-2 font-normal'>Target</th>
              <th className='px-2 font-normal'>Inject</th>
            </tr>
          </thead>
          <tbody>
            {paths.map((p) => (
              <SignalRow
                key={p}
                projectId={project.id}
                path={p}
                values={values[p]}
                onInjected={onInjected}
                onRemove={
                  extra.includes(p) ? () => setExtra((x) => x.filter((y) => y !== p)) : undefined
                }
              />
            ))}
          </tbody>
        </table>
        {!paths.length && (
          <p className='py-2 text-[12px] text-[var(--text-muted)]'>
            The workflow uses no signal yet
          </p>
        )}
      </div>
    </div>
  )
}
