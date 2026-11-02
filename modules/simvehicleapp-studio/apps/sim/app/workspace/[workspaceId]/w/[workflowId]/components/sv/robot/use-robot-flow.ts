'use client'

import { useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  adaptRobotWorkflow,
  isRobotWorkflow,
  type RobotCanvasBlock,
} from '@/lib/sv/robotics/robot-graph-adapter'
import { useSvWorkflowSettings } from '@/hooks/queries/sv-workflow-settings'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Domain of the open workflow (ADR-0068 Notes 2026-11-01): the signal catalog chosen in the Toolbar (VSS release or
 * RSS). A workflow saved before the setting existed is a robot one when it already holds robot blocks.
 */
export function useSvWorkflowDomain(): 'vehicle' | 'robot' {
  const params = useParams<{ workflowId?: string }>()
  const { data: settings } = useSvWorkflowSettings(params?.workflowId)
  const hasRobotBlocks = useWorkflowStore((s) => isRobotWorkflow(s.blocks))
  return settings?.domain === 'robot' || hasRobotBlocks ? 'robot' : 'vehicle'
}

/** True when the open workflow is a robot workflow (RSS blocks, robot actions). */
export function useIsRobotWorkflow(): boolean {
  return useSvWorkflowDomain() === 'robot'
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
