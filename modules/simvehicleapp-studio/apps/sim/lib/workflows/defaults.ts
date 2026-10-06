import { generateId } from '@sim/utils/id'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface DefaultWorkflowArtifacts {
  workflowState: WorkflowState
  subBlockValues: Record<string, Record<string, unknown>>
  startBlockId: string
}

/**
 * SV: a new vehicle-app workflow starts from an empty canvas. Runs are started by `sv_on_*`
 * trigger blocks; Sim's Start block (manual/API run) has no meaning in a vehicle app and its name
 * collides with user blocks (M03-T13, ADR-0011 Notes). `startBlockId` is kept as a reserved id
 * because the create-workflow contract still returns it.
 */
export function buildDefaultWorkflowArtifacts(): DefaultWorkflowArtifacts {
  const workflowState: WorkflowState = {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
  }

  return {
    workflowState,
    subBlockValues: {},
    startBlockId: generateId(),
  }
}
