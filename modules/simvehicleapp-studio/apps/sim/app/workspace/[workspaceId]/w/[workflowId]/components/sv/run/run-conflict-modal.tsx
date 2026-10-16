'use client'

import { ChipModal, ChipModalBody, ChipModalFooter, ChipModalHeader } from '@/components/emcn'
import type { SvMyRun } from '@/lib/api/contracts/sv'

interface RunConflictModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The app the user wants to run. */
  appName: string
  /** The other apps the user runs now. */
  others: SvMyRun[]
  /** Apps may run side by side (sandboxes, under the per-user quota). */
  parallel: boolean
  /** The stack gives every run vehicle signals of its own (else one app runs at a time). */
  sandbox: boolean
  pending: boolean
  onStopAndRun: () => void
  onRunBoth: () => void
}

/**
 * Run while the user already runs other apps (ADR-0057, M17-T05): stop them and run this one, or — with
 * sandboxes and room in the quota — run side by side. Each run has its own vehicle signals either way.
 */
export function RunConflictModal({
  open,
  onOpenChange,
  appName,
  others,
  parallel,
  sandbox,
  pending,
  onStopAndRun,
  onRunBoth,
}: RunConflictModalProps) {
  const names = others.map((r) => r.projectName).join(', ')
  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='You are already running an app'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        You are already running {others.length === 1 ? 'an app' : `${others.length} apps`}
      </ChipModalHeader>
      <ChipModalBody>
        <p data-sv='run-conflict' className='px-2 text-[var(--text-secondary)] text-small'>
          {names} {others.length === 1 ? 'is' : 'are'} running.{' '}
          {parallel
            ? `${appName} can run at the same time: each app gets vehicle signals of its own.`
            : `Stop ${others.length === 1 ? 'it' : 'them'} to run ${appName}: ${
                sandbox
                  ? 'you reached the number of apps you may run at once'
                  : 'this stack runs one app at a time'
              }.`}
        </p>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending ? 'Starting…' : `Stop ${others.length === 1 ? names : 'them'} and run`,
          onClick: onStopAndRun,
          disabled: pending,
        }}
        secondaryActions={
          parallel ? [{ label: 'Run both', onClick: onRunBoth, disabled: pending }] : undefined
        }
      />
    </ChipModal>
  )
}
