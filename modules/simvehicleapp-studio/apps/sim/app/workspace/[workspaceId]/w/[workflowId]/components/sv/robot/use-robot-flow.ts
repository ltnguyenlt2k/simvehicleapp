'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  adaptRobotWorkflow,
  isRobotWorkflow,
  type RobotCanvasBlock,
} from '@/lib/sv/robotics/robot-graph-adapter'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** True when the open workflow holds robot-domain blocks (ADR-0068 §1). */
export function useIsRobotWorkflow(): boolean {
  return useWorkflowStore((s) => isRobotWorkflow(s.blocks))
}

/**
 * The open canvas as a `robotflow.v1` document (adapter from `lib/sv/robotics`), plus its JSON for query keys.
 * Recomputed when blocks, links or any block value change; undefined until the workflow has loaded.
 */
export function useRobotFlow() {
  const params = useParams<{ workspaceId?: string; workflowId?: string }>()
  const workflowId = params?.workflowId
  const { data: workflows } = useWorkflowMap(params?.workspaceId)
  const state = useWorkflowStore(useShallow((s) => ({ blocks: s.blocks, edges: s.edges })))
  const subBlockValues = useSubBlockStore((s) =>
    workflowId ? s.workflowValues[workflowId] : undefined
  )
  const loaded = useWorkflowRegistry(
    (s) => s.hydration.phase === 'ready' && s.hydration.workflowId === workflowId
  )

  return useMemo(() => {
    if (!workflowId || !loaded) return undefined
    const merged: Record<string, RobotCanvasBlock> = mergeSubblockState(state.blocks, workflowId)
    const adapted = adaptRobotWorkflow({
      workflowId,
      name: workflows?.[workflowId]?.name ?? 'Untitled',
      blocks: merged,
      edges: state.edges,
    })
    return { workflowId, ...adapted, json: JSON.stringify(adapted.workflow) }
    // subBlockValues: mergeSubblockState reads the subblock store; recompute when it changes
  }, [workflowId, loaded, workflows, state, subBlockValues])
}
