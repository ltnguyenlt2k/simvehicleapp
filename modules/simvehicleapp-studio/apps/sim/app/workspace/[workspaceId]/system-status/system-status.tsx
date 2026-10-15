'use client'

import { useParams } from 'next/navigation'
import { Badge } from '@/components/emcn'
import type { SvCapacity, SvSystemService } from '@/lib/api/contracts/sv'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import { useSvCapacity } from '@/hooks/queries/sv-projects'
import { useSvSystemStatus } from '@/hooks/queries/sv-system'

const VARIANT = { ok: 'green', degraded: 'orange', down: 'red', unconfigured: 'gray' } as const

/** Disk levels of the host (ADR-0053 §B): what each one blocks. */
const DISK = {
  ok: { variant: 'green', label: 'ok', note: 'Nothing is blocked.' },
  low: { variant: 'amber', label: 'low', note: 'Running low: clean or delete unused apps.' },
  high: { variant: 'orange', label: 'high', note: 'New vehicle apps are blocked.' },
  flood: { variant: 'red', label: 'critical', note: 'SynCode is paused.' },
} as const

/**
 * System status (M11-T05, ADR-0033 §4): every SimVehicleApp service the studio reaches directly or
 * through the orchestrator, with its health, latency and version (commit, contracts).
 */
export function SystemStatus() {
  const params = useParams<{ workspaceId?: string }>()
  const { data, isLoading, error } = useSvSystemStatus()
  const { data: capacity } = useSvCapacity(params?.workspaceId)
  const services = data?.services ?? []
  const down = services.filter((s) => s.status === 'down' || s.status === 'degraded').length
  return (
    <div data-sv='system-status' className='flex h-full flex-col overflow-y-auto bg-[var(--bg)]'>
      <div className='mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-8'>
        <div className='flex flex-col gap-1'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>System status</h1>
          <p className='text-[13px] text-[var(--text-secondary)]'>
            {data
              ? `Studio ${data.studio.version} (${data.studio.commit.slice(0, 12)}) — ${services.length} services, ${down ? `${down} not healthy` : 'all healthy'}. Refreshes every 10 s.`
              : 'Health and version of every SimVehicleApp service.'}
          </p>
        </div>
        {capacity && <CapacityCards capacity={capacity} />}
        {isLoading && (
          <div className='text-[13px] text-[var(--text-muted)]'>Checking services…</div>
        )}
        {error && <div className='text-[13px] text-[var(--text-error)]'>{error.message}</div>}
        {services.length > 0 && (
          <table className='w-full border-collapse text-[13px]'>
            <thead>
              <tr className='border-[var(--border)] border-b text-left text-[var(--text-muted)]'>
                <th className='py-2 font-normal'>Service</th>
                <th className='py-2 font-normal'>Status</th>
                <th className='py-2 font-normal'>Latency</th>
                <th className='py-2 font-normal'>Version</th>
                <th className='py-2 font-normal'>Commit</th>
                <th className='py-2 font-normal'>Contracts</th>
                <th className='py-2 font-normal'>Checked by</th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <ServiceRow key={`${s.via}-${s.service}`} service={s} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

interface ServiceRowProps {
  service: SvSystemService
}

function ServiceRow({ service: s }: ServiceRowProps) {
  return (
    <tr
      className='border-[var(--border)] border-b'
      data-sv-service={s.service}
      data-sv-status={s.status}
    >
      <td className='py-2 text-[var(--text-primary)]'>{s.service}</td>
      <td className='py-2'>
        <Badge variant={VARIANT[s.status]} size='sm' title={s.error}>
          {s.status}
        </Badge>
      </td>
      <td className='py-2 text-[var(--text-secondary)]'>
        {s.latencyMs !== undefined ? `${s.latencyMs} ms` : '—'}
      </td>
      <td className='py-2 text-[var(--text-secondary)]'>{s.version ?? '—'}</td>
      <td className='py-2 font-mono text-[12px] text-[var(--text-secondary)]'>
        {s.commit ? s.commit.slice(0, 12) : '—'}
      </td>
      <td className='py-2 text-[var(--text-secondary)]'>{s.contracts ?? '—'}</td>
      <td className='py-2 text-[var(--text-muted)]'>{s.via}</td>
    </tr>
  )
}

interface CapacityCardsProps {
  capacity: SvCapacity
}

/** Free disk, vehicle apps against their quotas and the SynCode queue of the host (ADR-0053, M16-T05). */
function CapacityCards({ capacity }: CapacityCardsProps) {
  const { disk, host, workspace, queue } = capacity
  const level = disk ? DISK[disk.level] : null
  return (
    <div data-sv='capacity-cards' className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
      <div
        data-sv='capacity-disk-card'
        data-sv-level={disk?.level ?? 'unknown'}
        className='flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3'
      >
        <div className='flex items-center gap-2 text-[12px] text-[var(--text-muted)]'>
          Disk
          {level && (
            <Badge variant={level.variant} size='sm'>
              {level.label}
            </Badge>
          )}
        </div>
        <span className='text-[15px] text-[var(--text-primary)]'>
          {disk
            ? `${formatFileSize(disk.freeBytes)} free of ${formatFileSize(disk.totalBytes)}`
            : 'Cannot be measured right now'}
        </span>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          {level?.note ?? 'Nothing is blocked while the disk cannot be measured.'}
        </span>
      </div>
      <div
        data-sv='capacity-apps-card'
        className='flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3'
      >
        <span className='text-[12px] text-[var(--text-muted)]'>Vehicle apps</span>
        <span className='text-[15px] text-[var(--text-primary)]'>
          {`${host.apps} of ${host.limit} on this host`}
        </span>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          {`${workspace.apps} of ${workspace.limit} in this workspace`}
        </span>
      </div>
      <div
        data-sv='capacity-queue-card'
        className='flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3'
      >
        <span className='text-[12px] text-[var(--text-muted)]'>SynCode queue</span>
        <span className='text-[15px] text-[var(--text-primary)]'>
          {`${queue.queued} of ${queue.limit} waiting`}
        </span>
        <span className='text-[12px] text-[var(--text-secondary)]'>
          One SynCode builds at a time; a full queue asks to try again later.
        </span>
      </div>
    </div>
  )
}
