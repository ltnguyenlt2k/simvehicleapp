'use client'

import { useSvT } from '@/lib/sv/i18n/locale-provider'
import { useIsRobotWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'

/** Permanent safety-boundary notice (NFR-10); the robot domain has its own (ADR-0069). */
export function SvSafetyBanner() {
  const t = useSvT()
  const robot = useIsRobotWorkflow()
  return (
    <div
      role='note'
      data-sv='safety-banner'
      className='flex h-[24px] flex-shrink-0 items-center justify-center border-[var(--border)] border-b bg-[var(--surface-2)] px-2 text-[11px] text-[var(--text-muted)]'
    >
      {t(robot ? 'banner.robot' : 'banner.vehicle')}
    </div>
  )
}
