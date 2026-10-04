'use client'

import { useParams } from 'next/navigation'
import { useSvWorkflowSettings } from '@/hooks/queries/sv-workflow-settings'

/**
 * VSS release pinned on the open workflow (M02-T11), or `undefined` for the catalog default.
 * Every VSS view (Vehicle panel, path selector, typed values) reads it so they stay on one release.
 */
export function useSvWorkflowRelease(): string | undefined {
  const params = useParams<{ workflowId?: string }>()
  const { data } = useSvWorkflowSettings(params?.workflowId)
  return data?.vssRelease ?? undefined
}

/** Workflow id of the open editor, for the release picker. */
export function useSvWorkflowId(): string | undefined {
  return useParams<{ workflowId?: string }>()?.workflowId
}
