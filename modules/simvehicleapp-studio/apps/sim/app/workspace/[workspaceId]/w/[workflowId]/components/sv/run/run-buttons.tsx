'use client'

import { useEffect, useRef, useState } from 'react'
import { sleep } from '@sim/utils/helpers'
import { Clock, Play, Square } from 'lucide-react'
import { toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { type SvMyRun, svMyRunsContract } from '@/lib/api/contracts/sv'
import { RunConflictModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-conflict-modal'
import {
  canExtendSoon,
  runChoices,
  timeLeftLabel,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-time'
import { useNow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-now'
import { useRunFollow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import { useExtendSvRun, useMySvRuns, useStartSvRun, useStopSvRun } from '@/hooks/queries/sv-runs'
import { useSvRunStore } from '@/stores/sv/run/store'

/**
 * Run / Stop (M08-T08): runs the app of the project's latest SynCode on the KUKSA databroker of its
 * VSS release; Stop ends it (SIGINT, SIGKILL after 5 s). With sandboxes (ADR-0057) the run has vehicle
 * signals of its own, a time limit (Extend in its last minutes) and the user may run several apps.
 */
/** Polls My runs until none of `ids` is active (at most 10 s). */
async function waitUntilStopped(ids: Set<string>): Promise<boolean> {
  for (let waited = 0; waited < 10_000; waited += 500) {
    const mine = await requestJson(svMyRunsContract, {}).catch(() => null)
    if (mine && !mine.runs.some((r) => ids.has(r.id))) return true
    await sleep(500)
  }
  return false
}

interface RunButtonsProps {
  /** Run is the sensible next step: the app of this graph is built (ADR-0054). */
  primary?: boolean
}

export function RunButtons({ primary = false }: RunButtonsProps) {
  const { project, active } = useRunFollow()
  const { data: mine } = useMySvRuns()
  const start = useStartSvRun()
  const stop = useStopSvRun()
  const extend = useExtendSvRun()
  const [conflict, setConflict] = useState<SvMyRun[] | null>(null)
  const warned = useRef<string | null>(null)
  const now = useNow(15_000, Boolean(active?.expiresAt))
  const limits = mine?.limits ?? {
    sandbox: false,
    perUser: 1,
    total: 1,
    maxMinutes: 0,
    maxExtensions: 0,
  }
  const extendSoon = Boolean(active && canExtendSoon(active, limits.maxExtensions, now))

  useEffect(() => {
    if (!project || !active || !extendSoon || warned.current === active.id) return
    warned.current = active.id
    toast.warning(
      `${project.name} stops in ${timeLeftLabel(active.expiresAt, Date.now())}: press Extend to keep it running`
    )
  }, [project, active, extendSoon])

  const run = () => {
    if (!project) return
    start.mutate(project.id, {
      onSuccess: (r) => {
        setConflict(null)
        useSvRunStore.getState().follow(project.id, r.id)
        toast.success(`Running ${project.name} on VSS ${r.vssRelease}`)
      },
      onError: (e) => toast.error(`Run: ${e.message}`),
    })
  }
  const onRun = () => {
    if (!project) return
    const others = (mine?.runs ?? []).filter((r) => r.projectId !== project.id)
    if (runChoices(others.length, limits).ask) setConflict(others)
    else run()
  }
  const onStopAndRun = async () => {
    const ids = new Set((conflict ?? []).map((r) => r.id))
    for (const r of conflict ?? []) {
      await stop.mutateAsync({ projectId: r.projectId, runId: r.id }).catch(() => undefined)
    }
    // A stopping run still holds its slot: start once the others have stopped (SIGKILL after 5 s).
    const stopped = await waitUntilStopped(ids)
    if (!stopped)
      toast.warning('The other app is still stopping: Run may be refused, try again in a moment')
    run()
  }
  const onStop = () => {
    if (!project || !active) return
    stop.mutate(
      { projectId: project.id, runId: active.id },
      { onError: (e) => toast.error(`Stop: ${e.message}`) }
    )
  }
  const onExtend = () => {
    if (!project || !active) return
    extend.mutate(
      { projectId: project.id, runId: active.id },
      {
        onSuccess: (r) =>
          toast.success(
            `${project.name} runs until ${new Date(r.expiresAt ?? 0).toLocaleTimeString()}`
          ),
        onError: (e) => toast.error(`Extend: ${e.message}`),
      }
    )
  }

  const left = timeLeftLabel(active?.expiresAt, now)
  const runTitle = !project
    ? 'Press SynCode first: it creates the vehicle app of this workflow'
    : active
      ? `${project.name} is ${active.state}${left ? ` — stops by itself in ${left}` : ''}`
      : `Run the app of ${project.name}'s latest SynCode on the vehicle stack`
  return (
    <>
      <SvActionButton
        action='run'
        label={active?.state === 'running' ? 'Running' : 'Run'}
        icon={Play}
        busy={start.isPending || active?.state === 'starting'}
        busyLabel='Starting…'
        primary={primary}
        disabled={!project || Boolean(active)}
        onClick={onRun}
        title={runTitle}
        data={{ 'data-sv-run-state': active?.state ?? 'idle' }}
      />
      <SvActionButton
        action='stop'
        label='Stop'
        icon={Square}
        busy={stop.isPending || active?.state === 'stopping'}
        busyLabel='Stopping…'
        disabled={!active}
        onClick={onStop}
        title={active ? 'Stop the run (SIGINT, SIGKILL after 5 s)' : 'Nothing is running'}
      />
      {extendSoon && (
        <SvActionButton
          action='extend'
          label={`Extend (${left} left)`}
          icon={Clock}
          busy={extend.isPending}
          busyLabel='Extending…'
          onClick={onExtend}
          title={`Keep the app running ${limits.maxMinutes} min longer`}
        />
      )}
      {project && (
        <RunConflictModal
          open={conflict !== null}
          onOpenChange={(open) => !open && setConflict(null)}
          appName={project.name}
          others={conflict ?? []}
          parallel={runChoices(conflict?.length ?? 0, limits).parallel}
          sandbox={limits.sandbox}
          pending={start.isPending || stop.isPending}
          onStopAndRun={() => void onStopAndRun()}
          onRunBoth={run}
        />
      )}
    </>
  )
}
