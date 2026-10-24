'use client'

import { useMemo } from 'react'
import { mergeSubblockStateWithValues } from '@sim/workflow-persistence/subblocks'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { EMPTY_SUBBLOCK_VALUES, useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Blocks of the open workflow with the values being edited: the editor keeps subBlock values in the subblock store,
 * the workflow store's copy lags behind them. What the Logic view and "Used by" read (ADR-0059).
 */
export function useSvMergedBlocks() {
  const blocks = useWorkflowStore((s) => s.blocks)
  const workflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const values = useSubBlockStore((s) =>
    workflowId ? (s.workflowValues[workflowId] ?? EMPTY_SUBBLOCK_VALUES) : EMPTY_SUBBLOCK_VALUES
  )
  return useMemo(() => mergeSubblockStateWithValues(blocks, values), [blocks, values])
}
