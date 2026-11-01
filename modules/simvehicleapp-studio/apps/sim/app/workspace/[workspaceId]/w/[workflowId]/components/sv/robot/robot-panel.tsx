'use client'

import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/core/utils/cn'
import { useRobotFlow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
import { useSvRobotLint, useSvRobotRun } from '@/hooks/queries/sv-robotics'
import { useDebounce } from '@/hooks/use-debounce'
import { useSvRobotStore } from '@/stores/sv/robot/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const PHASE_COLOR: Record<string, string> = {
  SUCCEEDED: 'text-[#16A34A]',
  FAILED: 'text-[var(--text-error)]',
  REJECTED: 'text-[var(--text-error)]',
  TIMED_OUT: 'text-[var(--text-error)]',
  CANCELLED: 'text-[#D97706]',
}

/**
 * Bottom panel of a robot workflow: problems of the canvas, the build/deploy identity, and the live run — block
 * being executed (also highlighted on the canvas), robot command results with their request ids, and log lines.
 */
export function RobotPanel() {
  const flow = useRobotFlow()
  const mode = useSvRobotStore((s) => s.mode)
  const buildId = useSvRobotStore((s) => s.buildId)
  const deploymentId = useSvRobotStore((s) => s.deploymentId)
  const runId = useSvRobotStore((s) => s.runId)
  const setActiveNode = useSvRobotStore((s) => s.setActiveNode)
  const blocks = useWorkflowStore((s) => s.blocks)
  const debounced = useDebounce(flow?.json, 400)
  const lint = useSvRobotLint(flow?.workflowId, mode, debounced)
  const run = useSvRobotRun(runId ?? undefined)

  const problems = useMemo(
    () => [
      ...(flow?.issues ?? []).map((i) => ({ ...i, severity: 'error' as const, nodeId: i.blockId })),
      ...(lint.data?.diagnostics ?? []),
    ],
    [flow, lint.data]
  )
  const events = run.data?.events ?? []
  const active = useMemo(() => {
    if (run.data?.state !== 'running') return null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.ev === 'node') return e.state === 'started' ? (e.node ?? null) : null
    }
    return null
  }, [events, run.data?.state])

  useEffect(() => {
    setActiveNode(active)
  }, [active, setActiveNode])

  const name = (id?: string) => (id ? (blocks[id]?.name ?? id) : '')
  const timeline = events.filter(
    (e) =>
      e.ev === 'log' ||
      e.ev === 'error' ||
      e.ev === 'warning' ||
      e.ev === 'stop' ||
      (e.ev === 'command' && e.phase && e.phase !== 'ACCEPTED' && e.phase !== 'RUNNING')
  )

  return (
    <div
      className='flex h-[160px] shrink-0 border-[var(--border)] border-t bg-[var(--surface-1)] text-caption'
      data-rf-panel
    >
      <section className='flex w-[34%] min-w-0 flex-col border-[var(--border)] border-r p-2'>
        <div className='mb-1 text-[var(--text-muted)]'>Kiểm tra ({problems.length})</div>
        <ul className='min-h-0 flex-1 space-y-0.5 overflow-auto' data-rf-problems>
          {problems.length === 0 && <li className='text-[var(--text-secondary)]'>Không có lỗi.</li>}
          {problems.map((p, index) => (
            <li
              key={`${p.code}-${p.nodeId ?? ''}-${index}`}
              className={cn(
                p.severity === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]'
              )}
            >
              <span className='font-mono'>{p.code}</span> {p.nodeId ? `${name(p.nodeId)}: ` : ''}
              {p.message}
            </li>
          ))}
        </ul>
        <div className='mt-1 truncate text-[var(--text-muted)]' data-rf-identity>
          Build {buildId ? buildId.slice(0, 12) : '—'} · Deploy{' '}
          {deploymentId ? deploymentId.slice(0, 8) : '—'} · {mode}
        </div>
      </section>
      <section className='flex min-w-0 flex-1 flex-col p-2'>
        <div className='mb-1 flex items-center gap-2 text-[var(--text-muted)]'>
          <span>Chạy</span>
          <span data-rf-run-state className='text-[var(--text-body)]'>
            {run.data ? run.data.state : 'chưa chạy'}
          </span>
          {active && (
            <span
              data-rf-active
              className='rounded bg-[var(--surface-active)] px-1 text-[var(--text-body)]'
            >
              ▶ {name(active)}
            </span>
          )}
        </div>
        <ol className='min-h-0 flex-1 space-y-0.5 overflow-auto font-mono' data-rf-timeline>
          {timeline.slice(-200).map((e) => (
            <li
              key={e.seq}
              className={cn(
                e.ev === 'command' && e.phase ? PHASE_COLOR[e.phase] : '',
                e.ev === 'error' && 'text-[var(--text-error)]'
              )}
            >
              {e.ev === 'command'
                ? `${name(e.node)} → ${(e.path ?? '').replace('Robot.', '')} ${e.phase}${e.message ? ` (${e.message})` : ''}${e.requestId ? ` #${e.requestId.slice(0, 8)}` : ''}`
                : e.ev === 'stop'
                  ? `STOP ${String(e.confirmed) === 'true' ? 'xác nhận' : 'chưa xác nhận'}`
                  : `${e.level ?? e.ev}: ${e.message ?? ''}`}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
