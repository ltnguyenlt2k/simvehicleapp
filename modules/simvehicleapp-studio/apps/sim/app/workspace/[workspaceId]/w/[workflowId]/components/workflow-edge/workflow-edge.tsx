import { memo, useMemo } from 'react'
import { X } from 'lucide-react'
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { SV_HANDLE_COLOR, svEdgeLabel, svHandleTone } from '@/lib/sv/handle-labels'
import type { EdgeDiffStatus } from '@/lib/workflows/diff/types'
import { useSvEdgeFlow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/canvas/use-edge-flow'
import { useLastRunEdges } from '@/stores/execution'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

/** Extended edge props with optional handle identifiers */
interface WorkflowEdgeProps extends EdgeProps {
  sourceHandle?: string | null
  targetHandle?: string | null
}

const WorkflowEdgeComponent = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  source,
  target,
  sourceHandle,
  targetHandle,
}: WorkflowEdgeProps) => {
  const isHorizontal = sourcePosition === 'right' || sourcePosition === 'left'

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    offset: isHorizontal ? 30 : 20,
  })

  const isSelected = data?.isSelected ?? false

  const { diffAnalysis, isShowingDiff, isDiffReady } = useWorkflowDiffStore(
    useShallow((state) => ({
      diffAnalysis: state.diffAnalysis,
      isShowingDiff: state.isShowingDiff,
      isDiffReady: state.isDiffReady,
    }))
  )
  const lastRunEdges = useLastRunEdges()

  const dataSourceHandle = (data as { sourceHandle?: string } | undefined)?.sourceHandle
  const isErrorEdge = (sourceHandle ?? dataSourceHandle) === 'error'
  // SV: an edge leaving a named branch of a vehicle block says which one, in its colour (ADR-0055).
  const svBranch = sourceHandle ?? dataSourceHandle
  const svLabel = svEdgeLabel(svBranch)
  const svTone = svHandleTone(svBranch)
  // SV: the way the replay/live run went (ADR-0059 §4): taken bright, other branches dimmed, trigger value shown.
  const svFlow = useSvEdgeFlow(source, svBranch)
  const previewExecutionStatus = (
    data as { executionStatus?: 'success' | 'error' | 'not-executed' } | undefined
  )?.executionStatus
  const edgeRunStatus = previewExecutionStatus || lastRunEdges.get(id)

  const edgeDiffStatus = useMemo((): EdgeDiffStatus => {
    if (data?.isDeleted) return 'deleted'
    if (!diffAnalysis?.edge_diff || !isDiffReady) return null

    const actualSourceHandle = sourceHandle || 'source'
    const actualTargetHandle = targetHandle || 'target'
    const edgeIdentifier = `${source}-${actualSourceHandle}-${target}-${actualTargetHandle}`

    if (isShowingDiff) {
      if (diffAnalysis.edge_diff.new_edges.includes(edgeIdentifier)) return 'new'
      if (diffAnalysis.edge_diff.unchanged_edges.includes(edgeIdentifier)) return 'unchanged'
    } else {
      if (diffAnalysis.edge_diff.deleted_edges.includes(edgeIdentifier)) return 'deleted'
    }
    return null
  }, [
    data?.isDeleted,
    diffAnalysis,
    isDiffReady,
    isShowingDiff,
    source,
    target,
    sourceHandle,
    targetHandle,
  ])

  const edgeStyle = useMemo(() => {
    let color = 'var(--workflow-edge)'
    let opacity = 1

    if (edgeDiffStatus === 'deleted') {
      color = 'var(--text-error)'
      opacity = 0.7
    } else if (edgeDiffStatus === 'new') {
      color = 'var(--brand-accent)'
    } else if (edgeRunStatus === 'success') {
      // Use green for preview mode, default for canvas execution
      color = previewExecutionStatus ? 'var(--brand-accent)' : 'var(--border-success)'
    } else if (edgeRunStatus === 'error') {
      color = 'var(--text-error)'
    } else if (isErrorEdge) {
      // Error edges that weren't taken stay red
      color = 'var(--text-error)'
    } else if (svTone === 'positive' || svTone === 'warning') {
      color = SV_HANDLE_COLOR[svTone]
    }

    if (isSelected) {
      opacity = 0.5
    }
    if (!edgeDiffStatus && svFlow.state === 'taken') color = 'var(--border-success)'
    if (!edgeDiffStatus && svFlow.state === 'skipped') opacity = Math.min(opacity, 0.3)

    return {
      ...(style ?? {}),
      strokeWidth: edgeDiffStatus
        ? 3
        : edgeRunStatus === 'success' || edgeRunStatus === 'error' || svFlow.state === 'taken'
          ? 2.5
          : isSelected
            ? 2.5
            : 2,
      stroke: color,
      strokeDasharray: edgeDiffStatus === 'deleted' ? '10,5' : undefined,
      opacity,
    }
  }, [
    style,
    edgeDiffStatus,
    isSelected,
    isErrorEdge,
    edgeRunStatus,
    previewExecutionStatus,
    svTone,
    svFlow.state,
  ])

  return (
    <>
      <BaseEdge path={edgePath} style={edgeStyle} interactionWidth={30} />

      {svLabel && !isSelected && (
        <EdgeLabelRenderer>
          <div
            data-sv='edge-label'
            data-sv-branch={svBranch ?? undefined}
            className='nodrag nopan pointer-events-none rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-2)] px-1 text-[11px]'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              color: SV_HANDLE_COLOR[svTone],
              zIndex: 1010,
            }}
          >
            {svLabel}
          </div>
        </EdgeLabelRenderer>
      )}
      {svFlow.value !== null && !isSelected && (
        <EdgeLabelRenderer>
          <div
            data-sv='edge-value'
            className='nodrag nopan pointer-events-none absolute z-[1010] rounded-[4px] border border-[var(--border-success)] bg-[var(--surface-2)] px-1 font-mono text-[11px] text-[var(--text-primary)]'
            style={{ transform: `translate(-50%, -150%) translate(${labelX}px,${labelY}px)` }}
          >
            = {svFlow.value}
          </div>
        </EdgeLabelRenderer>
      )}

      {isSelected && (
        <EdgeLabelRenderer>
          <button
            type='button'
            className='nodrag nopan group flex size-[22px] cursor-pointer items-center justify-center transition-colors'
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: 1011,
            }}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()

              if (data?.onDelete) {
                data.onDelete(id)
              }
            }}
          >
            <X className='size-4 text-[var(--text-error)] transition-colors group-hover:text-[color-mix(in_srgb,var(--text-error)_80%,transparent)]' />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

/**
 * Workflow edge component with execution status and diff visualization.
 *
 * @remarks
 * Edge coloring priority:
 * 1. Diff status (deleted/new) - for version comparison
 * 2. Execution status (success/error) - for run visualization
 * 3. Error edge default (red) - for untaken error paths
 * 4. Default edge color - normal workflow connections
 */
export const WorkflowEdge = memo(WorkflowEdgeComponent)
