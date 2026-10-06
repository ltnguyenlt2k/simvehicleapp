'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useSvProjects } from '@/hooks/queries/sv-projects'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

/**
 * The vehicle-app project of the open workflow (SynCode, Run, Signals): the one chosen in the
 * action bar when the workflow belongs to several, else the first.
 */
export function useWorkflowProject() {
  const params = useParams<{ workspaceId?: string }>()
  const workflowId = useSvLintStore((s) => s.workflowId)
  const selectedProjectId = useSvSynCodeStore((s) => s.selectedProjectId)
  const { data: projects } = useSvProjects(params?.workspaceId)
  const candidates = useMemo(
    () =>
      (projects ?? []).filter((p) =>
        p.workflows.some((w) => w.enabled && w.simWorkflowId === workflowId)
      ),
    [projects, workflowId]
  )
  const project = candidates.find((p) => p.id === selectedProjectId) ?? candidates[0]
  return { project, candidates, workflowId }
}
