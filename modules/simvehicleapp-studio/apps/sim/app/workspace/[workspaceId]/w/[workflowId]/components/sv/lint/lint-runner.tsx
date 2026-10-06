'use client'

import { useEffect, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { type AdapterIssue, adaptWorkflow } from '@/lib/sv/graph-adapter'
import { useSvWorkflowRelease } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import { useSvLint } from '@/hooks/queries/sv-lint'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useDebounce } from '@/hooks/use-debounce'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useVariablesStore } from '@/stores/variables/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** analysis/05 §4: lint runs 300 ms after the last edit. */
export const SV_LINT_DEBOUNCE_MS = 300

/** Adapter issues shown like compiler diagnostics (catalog codes, structural stage). */
export function issueToDiagnostic(issue: AdapterIssue, workflowId: string): SvDiagnostic {
  return {
    code: issue.code,
    severity: 'error',
    stage: issue.code === 'CONTAINER_INVALID' ? 'structural' : 'block-config',
    workflowId,
    ...(issue.blockId ? { blockId: issue.blockId } : {}),
    message: issue.message,
    docs: `diagnostics#${issue.code}`,
  }
}

/**
 * Realtime lint driver (M03-T11): adapts the canvas to a WorkflowGraph, lints it through the BFF
 * 300 ms after the last change, and publishes the result to the lint store (Problems tab, badges).
 * It also publishes the current graph at once, for Verify (M04-T11).
 * Renders nothing. A lint outage keeps the previous result and marks the status unavailable.
 */
export function SvLintRunner() {
  const params = useParams<{ workspaceId?: string; workflowId?: string }>()
  const workflowId = params?.workflowId
  const { data: workflows } = useWorkflowMap(params?.workspaceId)
  const { data: catalog } = useSvCatalogReleases()
  const pinned = useSvWorkflowRelease()
  const release = pinned ?? catalog?.releases.find((r) => r.default)?.release
  const state = useWorkflowStore(
    useShallow((s) => ({
      blocks: s.blocks,
      edges: s.edges,
      loops: s.loops,
      parallels: s.parallels,
    }))
  )
  const allVariables = useVariablesStore((s) => s.variables)
  // Live subBlock values live in the subblock store, not in the workflow store (found by the M2 E2E).
  const subBlockValues = useSubBlockStore((s) =>
    workflowId ? s.workflowValues[workflowId] : undefined
  )
  const setResult = useSvLintStore((s) => s.setResult)
  const setStatus = useSvLintStore((s) => s.setStatus)
  const setGraph = useSvLintStore((s) => s.setGraph)

  const adapted = useMemo(() => {
    if (!workflowId || !release) return undefined
    const variables = Object.values(allVariables).filter((v) => v.workflowId === workflowId)
    return adaptWorkflow({
      workflowId,
      name: workflows?.[workflowId]?.name ?? 'Untitled',
      vssRelease: release,
      state: { ...state, blocks: mergeSubblockState(state.blocks, workflowId) },
      variables,
    })
    // subBlockValues: mergeSubblockState reads the subblock store; recompute when it changes
  }, [workflowId, release, workflows, state, allVariables, subBlockValues])

  const graphJson = useMemo(() => (adapted ? JSON.stringify(adapted.graph) : undefined), [adapted])
  const debounced = useDebounce(graphJson, SV_LINT_DEBOUNCE_MS)

  // Not debounced: Verify sends this graph, and any edit must invalidate a previous verify at once.
  useEffect(() => {
    if (!workflowId || !adapted || !graphJson) return
    setGraph(
      workflowId,
      graphJson,
      adapted.issues.map((i) => issueToDiagnostic(i, workflowId))
    )
  }, [workflowId, adapted, graphJson, setGraph])
  const { data, isError, isFetching } = useSvLint(workflowId, debounced)

  useEffect(() => {
    if (isFetching) setStatus('checking')
  }, [isFetching, setStatus])

  useEffect(() => {
    if (isError) setStatus('unavailable')
  }, [isError, setStatus])

  useEffect(() => {
    if (!data || !workflowId || !adapted) return
    setResult(workflowId, [
      ...adapted.issues.map((i) => issueToDiagnostic(i, workflowId)),
      ...data.diagnostics,
    ])
  }, [data, workflowId, adapted, setResult])

  return null
}
