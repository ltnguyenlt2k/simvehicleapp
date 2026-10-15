'use client'

import { useEffect, useState } from 'react'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import {
  deriveSvActionStatus,
  type SvActionStatus,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-status'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { useSvGeneration } from '@/hooks/queries/sv-projects'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Action bar state of the open workflow (ADR-0054): primary action, status pill, hint. Reads the stores and the
 * cached queries the buttons already use — it opens no stream of its own — and ticks once a second only while an
 * app runs (the pill shows its running time).
 */
export function useSvActionStatus(): SvActionStatus {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const diagnostics = useSvLintStore((s) => s.diagnostics)
  const verifyStatus = useSvLintStore((s) => s.verifyStatus)
  const verifiedFresh = useSvLintStore((s) => s.verifiedFresh)
  const simStatus = useSvSimulationStore((s) => s.status)
  const { project, workflowId } = useWorkflowProject()
  const loaded = useWorkflowRegistry(
    (s) => s.hydration.phase === 'ready' && s.hydration.workflowId === workflowId
  )
  const autoProjectId = useSvSynCodeStore((s) => s.autoSynCodeProjectId)
  const followedProjectId = useSvSynCodeStore((s) => s.projectId)
  const generationId = useSvSynCodeStore((s) => s.generationId)
  const sentGraphJson = useSvSynCodeStore((s) => s.sentGraphJson)
  const ofThisApp = Boolean(project && followedProjectId === project.id)
  const { data: generation } = useSvGeneration(
    ofThisApp ? (followedProjectId ?? undefined) : undefined,
    ofThisApp ? (generationId ?? undefined) : undefined
  )
  const { run } = useWorkflowRuns()
  const [now, setNow] = useState(() => Date.now())

  const running = run?.state === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  return deriveSvActionStatus({
    loaded,
    hasGraph: Boolean(graphJson),
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    verifyStatus,
    verifiedFresh,
    simStatus,
    project: project ? { name: project.name, status: project.status } : null,
    preparing: Boolean(project && autoProjectId === project.id && project.status === 'creating'),
    generation: generation
      ? { state: generation.state, stage: generation.stage, stages: generation.stages }
      : undefined,
    generationFresh: Boolean(graphJson && sentGraphJson === graphJson),
    run: run ? { state: run.state, runningAt: run.runningAt } : undefined,
    now: running ? now : Date.now(),
  })
}
