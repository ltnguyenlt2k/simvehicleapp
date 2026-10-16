'use client'

import { Activity, ChevronDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@/components/emcn'
import { timeLeftLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-time'
import { useNow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-now'
import { useExtendSvRun, useMySvRuns, useStopSvRun } from '@/hooks/queries/sv-runs'

/**
 * My runs (ADR-0057, M17-T05): the apps the user runs now in any workspace — release, state, time left — with
 * Stop and Extend, so a run started elsewhere is never forgotten. Hidden while nothing runs.
 */
export function MyRunsMenu() {
  const router = useRouter()
  const { data } = useMySvRuns()
  const stop = useStopSvRun()
  const extend = useExtendSvRun()
  const runs = data?.runs ?? []
  const now = useNow(15_000, runs.length > 0)
  if (!runs.length) return null
  const limits = data?.limits
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          data-sv='my-runs'
          data-sv-count={runs.length}
          className='gap-1.5'
          title='The vehicle apps you are running'
        >
          <Activity aria-hidden className='size-[14px] shrink-0 text-[var(--text-success)]' />
          My runs ({runs.length})
          <ChevronDown aria-hidden className='size-[12px] shrink-0' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' sideOffset={4} className='min-w-[260px]'>
        {limits && (
          <DropdownMenuLabel className='font-normal text-[var(--text-muted)] text-caption'>
            {limits.sandbox
              ? `${runs.length} of ${limits.perUser} apps you may run at once`
              : 'One app runs at a time on this stack'}
          </DropdownMenuLabel>
        )}
        {runs.map((run) => {
          const left = timeLeftLabel(run.expiresAt, now)
          const canExtend =
            run.state === 'running' &&
            run.expiresAt !== undefined &&
            (run.extensions ?? 0) < (limits?.maxExtensions ?? 0)
          return (
            <div key={run.id} data-sv='my-run' data-sv-run={run.id}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className='flex flex-col gap-0.5 font-normal'>
                <span className='text-[var(--text-primary)] text-small'>{run.projectName}</span>
                <span className='text-[var(--text-muted)] text-caption'>
                  VSS {run.vssRelease} · {run.state}
                  {left ? ` · stops in ${left}` : ''}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => router.push(`/workspace/${run.workspaceId}/vehicle-projects`)}
              >
                Show in Vehicle apps
              </DropdownMenuItem>
              {canExtend && (
                <DropdownMenuItem
                  data-sv='my-run-extend'
                  onSelect={() =>
                    extend.mutate(
                      { projectId: run.projectId, runId: run.id },
                      {
                        onSuccess: () => toast.success(`${run.projectName} keeps running longer`),
                        onError: (e) => toast.error(`Extend: ${e.message}`),
                      }
                    )
                  }
                >
                  Extend {limits?.maxMinutes ? `${limits.maxMinutes} min` : ''}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                data-sv='my-run-stop'
                disabled={run.state === 'stopping'}
                onSelect={() =>
                  stop.mutate(
                    { projectId: run.projectId, runId: run.id },
                    { onError: (e) => toast.error(`Stop: ${e.message}`) }
                  )
                }
              >
                Stop
              </DropdownMenuItem>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
