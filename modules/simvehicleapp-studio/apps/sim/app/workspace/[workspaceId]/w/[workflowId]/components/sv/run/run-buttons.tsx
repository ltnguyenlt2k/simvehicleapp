'use client'

import { Button, toast } from '@/components/emcn'
import { useRunFollow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { useStartSvRun, useStopSvRun } from '@/hooks/queries/sv-runs'
import { useSvRunStore } from '@/stores/sv/run/store'

/**
 * Run / Stop (M08-T08): runs the app of the project's latest SynCode on the KUKSA databroker of its
 * VSS release; Stop ends it (SIGINT, SIGKILL after 5 s). One run at a time on the vehicle stack.
 */
export function RunButtons() {
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
    ? 'Add this workflow to a vehicle project first (Vehicle projects page)'
    : active
      ? `${project.name} is ${active.state}`
      : `Run the app of ${project.name}'s latest SynCode on the vehicle stack`
  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        data-sv-action='run'
        data-sv-run-state={active?.state ?? 'idle'}
        aria-busy={start.isPending || undefined}
        disabled={!project || Boolean(active) || start.isPending}
        onClick={onRun}
        title={runTitle}
      >
        {active?.state === 'running'
          ? 'Running'
          : active?.state === 'starting'
            ? 'Starting…'
            : 'Run'}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        data-sv-action='stop'
        disabled={!active || active.state === 'stopping' || stop.isPending}
        onClick={onStop}
        title={active ? 'Stop the run (SIGINT, SIGKILL after 5 s)' : 'Nothing is running'}
      >
        {active?.state === 'stopping' ? 'Stopping…' : 'Stop'}
      </Button>
    </>
  )
}
