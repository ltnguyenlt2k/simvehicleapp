'use client'

import { Badge } from '@/components/emcn'
import type { SvSystemService } from '@/lib/api/contracts/sv'
import { useSvSystemStatus } from '@/hooks/queries/sv-system'

const VARIANT = { ok: 'green', degraded: 'orange', down: 'red', unconfigured: 'gray' } as const

/**
 * System status (M11-T05, ADR-0033 §4): every SimVehicleApp service the studio reaches directly or
 * through the orchestrator, with its health, latency and version (commit, contracts).
 */
export function SystemStatus() {
  const { data, isLoading, error } = useSvSystemStatus()
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
