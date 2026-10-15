'use client'

import { Play, Square } from 'lucide-react'
import { toast } from '@/components/emcn'
import { useRunFollow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import { useStartSvRun, useStopSvRun } from '@/hooks/queries/sv-runs'
import { useSvRunStore } from '@/stores/sv/run/store'

/**
 * Run / Stop (M08-T08): runs the app of the project's latest SynCode on the KUKSA databroker of its
 * VSS release; Stop ends it (SIGINT, SIGKILL after 5 s). One run at a time on the vehicle stack.
 */
interface RunButtonsProps {
  /** Run is the sensible next step: the app of this graph is built (ADR-0054). */
  primary?: boolean
}

export function RunButtons({ primary = false }: RunButtonsProps) {
  const { project, active } = useRunFollow()
  const start = useStartSvRun()
  const stop = useStopSvRun()

  const onRun = () => {
    if (!project) return
    start.mutate(project.id, {
      onSuccess: (run) => {
        useSvRunStore.getState().follow(project.id, run.id)
        toast.success(`Running ${project.name} on VSS ${run.vssRelease}`)
      },
      onError: (e) => toast.error(`Run: ${e.message}`),
    })
  }
  const onStop = () => {
    if (!project || !active) return
    stop.mutate(
      { projectId: project.id, runId: active.id },
      { onError: (e) => toast.error(`Stop: ${e.message}`) }
    )
  }

  const runTitle = !project
    ? 'Press SynCode first: it creates the vehicle app of this workflow'
    : active
      ? `${project.name} is ${active.state}`
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
    </>
  )
}
