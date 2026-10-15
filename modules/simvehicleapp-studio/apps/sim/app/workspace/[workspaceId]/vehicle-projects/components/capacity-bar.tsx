'use client'

import { cn } from '@/lib/core/utils/cn'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { useSvCapacity } from '@/hooks/queries/sv-projects'

/** What each disk level means for the user (ADR-0053 §B: low warns, high blocks new apps, flood pauses SynCode). */
const DISK_HINT = {
  ok: null,
  low: 'Disk space is getting low on the host: clean or delete apps you no longer need.',
  high: 'Disk space is low on the host: no new vehicle app until space is freed.',
  flood: 'Disk space is almost exhausted on the host: SynCode is paused until space is freed.',
} as const

interface CapacityBarProps {
  workspaceId: string
}

/** Apps used in this workspace against its quota, and the host's free disk (ADR-0053, M16-T04). */
export function CapacityBar({ workspaceId }: CapacityBarProps) {
  const { data } = useSvCapacity(workspaceId)
  if (!data) return null
  const { workspace, disk } = data
  const full = workspace.limit > 0 && workspace.apps >= workspace.limit
  const hint = disk ? DISK_HINT[disk.level] : null

  return (
    <div data-sv='capacity' className='flex flex-col gap-1.5'>
      <div className='flex items-center gap-3 text-[12px] text-[var(--text-secondary)]'>
        <span data-sv='capacity-apps' className={cn(full && 'text-[var(--text-error)]')}>
          {`${workspace.apps}/${workspace.limit} apps in this workspace`}
        </span>
        {disk && (
          <span
            data-sv='capacity-disk'
            data-sv-level={disk.level}
            className={cn(disk.level !== 'ok' && 'text-[var(--text-error)]')}
          >
            {`${formatFileSize(disk.freeBytes)} free on the host`}
          </span>
        )}
      </div>
      {full && (
        <p className='text-[12px] text-[var(--text-error)]'>
          This workspace has reached its app limit: delete or reuse an app to create another.
        </p>
      )}
      {hint && <p className='text-[12px] text-[var(--text-error)]'>{hint}</p>}
    </div>
  )
}
