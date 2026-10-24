'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ChipInput, ChipSelect, toast } from '@/components/emcn'
import { type SvSignalField, type SvVssNode, svSignalUpdateSchema } from '@/lib/api/contracts/sv'
import {
  applySignalUpdates,
  graphSignalPaths,
  type parseSignalInput,
  type Recording,
  recordingToScenario,
  type SignalValues,
  signalInputOf,
  triggerHints,
  typedValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-model'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { useSvCatalogNodes, useSvCatalogSearch } from '@/hooks/queries/sv-catalog'
import { usePlaySvScenario, useSetSvSignal } from '@/hooks/queries/sv-runs'
import { useSvScenario } from '@/hooks/queries/sv-simulation'
import { useCreateSvTestCase } from '@/hooks/queries/sv-test-cases'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvTestStore } from '@/stores/sv/test/store'

const PATH = /^Vehicle(\.[A-Za-z0-9_]+)+$/
const shown = (v: SignalValues['value']) =>
  v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v)

interface SignalRowProps {
  projectId: string
  path: string
  values?: SignalValues
  /** Catalog entry of the signal: kind, type, unit, range, allowed values (typed inject, M18-T05). */
  node?: SvVssNode
  /** A trigger fires on its change, e.g. "rises: false → true". */
  hint?: string
  onInjected: (
    path: string,
    value: ReturnType<typeof parseSignalInput>,
    field: SvSignalField
  ) => void
  onRemove?: () => void
  /** A deployment: its signals come from the target, Set is disabled (ADR-0060). */
  readOnly?: boolean
}

const FIELD_LABEL: Record<SvSignalField, string> = {
  target: 'request (target)',
  value: 'simulate feedback (current)',
}

function SignalRow({
  projectId,
  path,
  values,
  node,
  hint,
  onInjected,
  onRemove,
  readOnly = false,
}: SignalRowProps) {
  const input = signalInputOf(node)
  const { control } = input
  const [text, setText] = useState(control.kind === 'bool' ? 'true' : '')
  const [field, setField] = useState<SvSignalField>(input.defaultField)
  const set = useSetSvSignal()
  const inject = () => {
    const typed = typedValue(control, text)
    if (!typed.ok) {
      toast.error(`${path}: ${typed.error}`)
      return
    }
    set.mutate(
      { projectId, path, value: typed.value, field },
      {
        onSuccess: () => onInjected(path, typed.value, field),
        onError: (e) => toast.error(e.message),
      }
    )
  }
  const range =
    control.kind === 'number'
      ? [
          control.min !== undefined && control.max !== undefined
            ? `${control.min}…${control.max}`
            : '',
          control.unit ?? '',
        ]
          .filter(Boolean)
          .join(' ')
      : ''
  return (
    <tr
      data-sv-signal={path}
      data-sv-signal-kind={node?.kind}
      className='border-[var(--border)] border-b'
    >
      <td className='py-0.5 pr-2' title={node?.description ?? path}>
        <div className='truncate font-mono text-[11px]'>{path}</div>
        {(node || hint) && (
          <div className='truncate text-[10px] text-[var(--text-muted)]'>
            {[node?.kind, node?.datatype, node?.unit].filter(Boolean).join(' · ')}
            {hint ? `${node ? ' — ' : ''}${hint}` : ''}
          </div>
        )}
      </td>
      <td
        className='px-2 font-mono text-[11px]'
        data-sv-signal-value
        title={values?.value === undefined ? 'No value yet' : undefined}
      >
        {shown(values?.value)}
      </td>
      <td className='px-2 font-mono text-[11px]' data-sv-signal-target>
        {node && node.kind !== 'actuator' ? '' : shown(values?.target)}
      </td>
      <td className='px-2'>
        <div className='flex items-center gap-1'>
          {control.kind === 'bool' || control.kind === 'enum' ? (
            <ChipSelect
              aria-label={`Value for ${path}`}
              value={text}
              onChange={(v) => setText(String(v))}
              options={(control.kind === 'bool' ? ['true', 'false'] : control.options).map((o) => ({
                label: o,
                value: o,
              }))}
            />
          ) : (
            <ChipInput
              aria-label={`Value for ${path}`}
              value={text}
              inputMode={control.kind === 'number' ? 'decimal' : undefined}
              placeholder={control.kind === 'number' ? range || 'number' : '130, true, SLOW…'}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && text.trim() && inject()}
              className='w-[120px]'
            />
          )}
          {input.fields.length > 1 ? (
            <ChipSelect
              aria-label={`Field for ${path}`}
              value={field}
              onChange={(v) => setField(v as SvSignalField)}
              options={input.fields.map((f) => ({ label: node ? FIELD_LABEL[f] : f, value: f }))}
            />
          ) : (
            <span className='px-1 text-[10px] text-[var(--text-muted)]'>value</span>
          )}
          <Button
            variant='ghost'
            size='sm'
            data-sv-inject={path}
            disabled={readOnly || !text.trim() || set.isPending}
            title={readOnly ? 'Deployed: the signals come from the target' : undefined}
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

/** The VSS path of a signal dragged from the Vehicle panel (`{type: 'sv_signal', svSignal: {path}}`), else null. */
export function droppedSignalPath(data: string): string | null {
  try {
    const v = JSON.parse(data) as { type?: unknown; svSignal?: { path?: unknown } }
    const path = v?.type === 'sv_signal' ? v.svSignal?.path : undefined
    return typeof path === 'string' && PATH.test(path) ? path : null
  } catch {
    return null
  }
}

/** Signals watched by hand, kept per workflow in this browser (a convenience: an unreadable store is empty). */
function useWatchList(
  workflowId: string | null
): [string[], (f: (x: string[]) => string[]) => void] {
  const storageKey = workflowId ? `sv-watch:${workflowId}` : null
  const [list, setList] = useState<string[]>([])
  useEffect(() => {
    if (!storageKey) return setList([])
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]') as unknown
      setList(
        Array.isArray(raw)
          ? raw.filter((p): p is string => typeof p === 'string' && PATH.test(p))
          : []
      )
    } catch {
      setList([])
    }
  }, [storageKey])
  const update = useCallback(
    (f: (x: string[]) => string[]) =>
      setList((prev) => {
        const next = f(prev)
        try {
          if (storageKey) window.localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // storage unavailable (private window): the list lives until reload
        }
        return next
      }),
    [storageKey]
  )
  return [list, update]
}

/**
 * Signals panel (M08-T08/T09): current value and actuator target of the watched signals on the
 * databroker of the project's VSS release (live), inject, record injections as the workflow's
 * scenario, and play the saved scenario on the databroker (M08-T07).
 */
export function SignalsPanel() {
  const { project, run } = useWorkflowRuns()
  /** Following a deployment (ADR-0060): watch only — inject, Record and Play are refused by the server too. */
  const deployed = run?.deploy
  const workflowId = useSvLintStore((s) => s.workflowId)
  const graphJson = useSvLintStore((s) => s.graphJson)
  const fromGraph = useMemo(() => graphSignalPaths(graphJson), [graphJson])
  const [extra, setExtra] = useWatchList(workflowId)
  const [adding, setAdding] = useState('')
  const [values, setValues] = useState<Record<string, SignalValues>>({})
  const [recording, setRecording] = useState<Recording | null>(null)
  const recordingRef = useRef<Recording | null>(null)
  const { data: scenario } = useSvScenario(workflowId ?? undefined)
  const create = useCreateSvTestCase(workflowId ?? undefined)
  const play = usePlaySvScenario()
  const paths = useMemo(() => [...new Set([...fromGraph, ...extra])], [fromGraph, extra])
  const key = paths.join(',')
  const projectId = project?.id
  const { data: nodes } = useSvCatalogNodes(project?.vssRelease, paths)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  /** Values the user injected (path=value): their echo is not the app's write. */
  const injectedRef = useRef(new Set<string>())
  const hints = useMemo(() => triggerHints(graphJson), [graphJson])
  const { data: found } = useSvCatalogSearch(
    project?.vssRelease,
    adding.length >= 2 && !PATH.test(adding) ? adding : ''
  )
  const suggestions = (found?.nodes ?? [])
    .filter((n) => n.kind !== 'branch' && !paths.includes(n.path))
    .slice(0, 6)
  const watch = (p: string) => {
    setExtra((x) => (x.includes(p) ? x : [...x, p]))
    setAdding('')
  }
  const focusSignal = useSvRunStore((s) => s.focusSignal)

  // A write picked in Flow (M19-T05): watch that signal and bring its row into view.
  useEffect(() => {
    if (!focusSignal) return
    const { path } = focusSignal
    setExtra((x) => (x.includes(path) ? x : [...x, path]))
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-sv="signals"] [data-sv-signal="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: 'center' })
    )
  }, [focusSignal, setExtra])

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
      if (!v.success) return
      setValues((prev) => applySignalUpdates(prev, [v.data]))
      const injected = injectedRef.current.has(`${v.data.path}=${JSON.stringify(v.data.value)}`)
      // The gateway names the source (ADR-0062 §3); an older gateway does not, so the user's own inject is known here.
      useSvRunStore.getState().pushSignal({ ...(injected ? { source: 'inject' } : {}), ...v.data })
      // While recording, an actuator the app changed (target, or current through a provider) is a proposed expectation.
      const rec = recordingRef.current
      const u = v.data
      if (
        rec &&
        nodesRef.current?.get(u.path)?.kind === 'actuator' &&
        !injectedRef.current.has(`${u.path}=${JSON.stringify(u.value)}`)
      ) {
        const next = {
          ...rec,
          observed: [
            ...(rec.observed ?? []),
            { t: Date.now() - rec.startedAt, path: u.path, value: u.value as never },
          ],
        }
        recordingRef.current = next
        setRecording(next)
      }
    })
    return () => source.close()
  }, [projectId, key])

  if (!project) {
    return (
      <div className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'>
        Press SynCode to create the vehicle app of this workflow, then Run it to watch and inject
        its signals
      </div>
    )
  }

  const onInjected = (
    path: string,
    value: ReturnType<typeof parseSignalInput>,
    field: SvSignalField
  ) => {
    injectedRef.current.add(`${path}=${JSON.stringify(value)}`)
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
    injectedRef.current = new Set()
    setRecording({ startedAt: Date.now(), initial, inputs: [], observed: [] })
  }
  const saveRecording = () => {
    if (!recording) return
    const s = recordingToScenario(
      recording,
      `Recorded ${new Date(recording.startedAt).toLocaleTimeString()}`
    )
    // A recording is a new test case (ADR-0058 §7): it never replaces an existing one.
    create.mutate(
      { name: s.name.slice(0, 80), scenario: s },
      {
        onSuccess: (c) => {
          toast.success(
            `Saved as the test case "${c.name}" (${s.inputs.length} inputs) — open in Test`
          )
          setRecording(null)
          useSvTestStore.getState().setActiveCase(c.id)
          useSvSimulationStore.getState().showSimulation()
        },
        onError: (e) => toast.error(e.message),
      }
    )
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
      {deployed && (
        <p
          data-sv='deployed-banner'
          className='shrink-0 border-[var(--border)] border-b bg-[var(--surface-5)] px-2 py-1 text-[12px] text-[var(--text-secondary)]'
        >
          {`Deployed to ${deployed.targetName} (${deployed.mode}): the signals come from the target; inject, Record and Play are disabled.`}
        </p>
      )}
      <div className='flex shrink-0 items-center gap-2 border-[var(--border)] border-b px-2 py-1'>
        <span className='text-[12px] text-[var(--text-secondary)]'>{`VSS ${project.vssRelease}`}</span>
        <ChipInput
          aria-label='Watch a signal'
          placeholder='Search or Vehicle.Cabin.…'
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const p = adding.trim()
            if (PATH.test(p)) return watch(p)
            if (suggestions[0]) return watch(suggestions[0].path)
            toast.error('A VSS path like Vehicle.Speed, or words to search')
          }}
          className='w-[260px]'
        />
        {suggestions.length > 0 && (
          <div className='flex min-w-0 flex-wrap gap-1' data-sv='watch-suggestions'>
            {suggestions.map((n) => (
              <Button
                key={n.path}
                size='sm'
                variant='ghost'
                onClick={() => watch(n.path)}
                title={n.description ?? n.path}
              >
                {n.path.split('.').slice(-2).join('.')}
              </Button>
            ))}
          </div>
        )}
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
                disabled={!recording.inputs.length || create.isPending}
                onClick={saveRecording}
              >
                Save as test case
              </Button>
            </>
          ) : (
            <Button
              variant='ghost'
              size='sm'
              data-sv='record'
              disabled={Boolean(deployed)}
              onClick={startRecording}
              title='Record injected values as a new test case (Test tab)'
            >
              Record
            </Button>
          )}
          <Button
            variant='ghost'
            size='sm'
            data-sv='play-scenario'
            disabled={Boolean(deployed) || !scenario || play.isPending}
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
      <div
        className='min-h-0 flex-1 overflow-auto px-2'
        data-sv='signals-drop'
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/json')) e.preventDefault()
        }}
        onDrop={(e) => {
          // A signal dragged from the Vehicle panel joins the watched signals (M18-T05).
          const p = droppedSignalPath(e.dataTransfer.getData('application/json'))
          if (!p) return
          e.preventDefault()
          watch(p)
        }}
      >
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
                node={nodes?.get(p)}
                hint={hints.get(p)}
                onInjected={onInjected}
                readOnly={Boolean(deployed)}
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
