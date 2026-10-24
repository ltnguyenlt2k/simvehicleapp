'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { svLogLineSchema, svTraceEventSchema } from '@/lib/api/contracts/sv'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { activeRunOf, svRunKeys, useSvRuns } from '@/hooks/queries/sv-runs'
import { useSvRunStore } from '@/stores/sv/run/store'

/** Events are handed to the store in small batches (a busy app logs thousands of lines a second). */
const FLUSH_MS = 100

/** The open workflow's project, its runs, the active one and the one the editor follows. */
export function useWorkflowRuns() {
  const { project } = useWorkflowProject()
  const { data: runs } = useSvRuns(project?.id)
  // A test run and a deployment of the app may be active at once (ADR-0060): Run/Stop act on the run, the dock follows
  // the run, else the deployment.
  const active = activeRunOf(runs?.filter((r) => !r.deploy))
  const deployment = activeRunOf(runs?.filter((r) => r.deploy))
  const runId = useSvRunStore((s) => s.runId)
  const followed = runs?.find((r) => r.id === runId)
  return { project, runs, active, deployment, followed, run: active ?? deployment ?? followed }
}

/**
 * Follows the live run of the open workflow's project (M08-T08): its log and trace stream over SSE
 * into the run store until the run ends. After a page reload the stream starts from the stored
 * backlog, so nothing is lost (ADR-0027 §2). Mounted once (action bar); readers use useWorkflowRuns.
 */
export function useRunFollow() {
  const queryClient = useQueryClient()
  const { project, runs, active: testRun, deployment } = useWorkflowRuns()
  const active = testRun ?? deployment
  const runId = useSvRunStore((s) => s.runId)
  const reported = useRef<string | null>(null)

  useEffect(() => {
    if (project && active && useSvRunStore.getState().runId !== active.id) {
      useSvRunStore.getState().follow(project.id, active.id)
    }
  }, [project, active])

  const following = Boolean(project && runId && active?.id === runId)
  useEffect(() => {
    if (!project || !runId || !following) return
    const projectId = project.id
    const source = new EventSource(
      `/api/sv/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/events`
    )
    let pending: Parameters<ReturnType<typeof useSvRunStore.getState>['ingest']>[1] = []
    const timer = setInterval(() => {
      if (!pending.length) return
      const batch = pending
      pending = []
      useSvRunStore.getState().ingest(runId, batch)
    }, FLUSH_MS)
    source.addEventListener('log', (e) => {
      const v = svLogLineSchema.safeParse(JSON.parse((e as MessageEvent<string>).data))
      if (v.success) pending.push({ event: 'log', data: v.data })
    })
    source.addEventListener('trace', (e) => {
      const v = svTraceEventSchema.safeParse(JSON.parse((e as MessageEvent<string>).data))
      if (v.success) pending.push({ event: 'trace', data: v.data })
    })
    source.onerror = () => {
      // The stream closes when the run ends: refresh its state (the browser reconnects otherwise).
      queryClient.invalidateQueries({ queryKey: svRunKeys.list(projectId) })
    }
    return () => {
      source.close()
      clearInterval(timer)
      if (pending.length) useSvRunStore.getState().ingest(runId, pending)
    }
  }, [project, runId, following, queryClient])

  const last = runs?.find((r) => r.id === runId)
  useEffect(() => {
    if (!last) return
    const live = last.state === 'starting' || last.state === 'running' || last.state === 'stopping'
    useSvRunStore.getState().setActive(last.id, live)
    if (live) return
    if (reported.current === last.id) return
    reported.current = last.id
    if (last.state === 'crashed') {
      toast.error(`Run ended: ${last.diagnostics[0]?.message ?? 'the app stopped unexpectedly'}`)
      useSvRunStore.getState().showRunConsole()
    }
  }, [last])

  // Run/Stop act on test runs only: a deployment is stopped from its Deploy dialog (ADR-0060).
  return { project, run: testRun ?? (last?.deploy ? undefined : last), active: testRun }
}
