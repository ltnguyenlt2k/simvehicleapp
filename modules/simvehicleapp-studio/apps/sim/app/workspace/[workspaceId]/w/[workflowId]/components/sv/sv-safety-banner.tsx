import { useIsRobotWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
import {
  SV_ROBOT_SAFETY_NOTICE,
  SV_SAFETY_NOTICE,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'

/** Permanent safety-boundary notice (NFR-10); the robot domain has its own (ADR-0069). */
export function SvSafetyBanner() {
  const robot = useIsRobotWorkflow()
  return (
    <div
      role='note'
      data-sv='safety-banner'
      className='flex h-[24px] flex-shrink-0 items-center justify-center border-[var(--border)] border-b bg-[var(--surface-2)] px-2 text-[11px] text-[var(--text-muted)]'
    >
      {robot ? SV_ROBOT_SAFETY_NOTICE : SV_SAFETY_NOTICE}
    </div>
  )
}
