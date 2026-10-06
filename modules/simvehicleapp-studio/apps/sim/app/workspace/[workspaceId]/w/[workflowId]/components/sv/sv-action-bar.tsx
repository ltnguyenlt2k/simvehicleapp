'use client'

import { useCallback } from 'react'
import { Button, toast } from '@/components/emcn'
import { SV_ACTIONS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'
import { useSvVerify } from '@/hooks/queries/sv-lint'
import { useSvLintStore } from '@/stores/sv/lint/store'

/** Actions that work today; the others stay disabled until their milestone ships. */
const READY = new Set<string>(['verify'])

/**
 * Workflow actions of the vehicle editor. Verify (M04-T11) runs every compiler check on the graph
 * on the canvas and shows the result in Problems; it is stale as soon as the canvas changes.
 */
export function SvActionBar() {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const verifyStatus = useSvLintStore((s) => s.verifyStatus)
  const verify = useSvVerify()

  const onVerify = useCallback(() => {
    const {
      graphJson: current,
      setVerified,
      setVerifyStatus,
      showProblems,
    } = useSvLintStore.getState()
    if (!current) return
    setVerifyStatus('verifying')
    verify.mutate(current, {
      onSuccess: (result) => {
        setVerified(current, result.diagnostics)
        showProblems()
        const errors = result.diagnostics.filter((d) => d.severity === 'error').length
        const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length
        if (errors) toast.error(`Verify: ${errors} error${errors === 1 ? '' : 's'} to fix`)
        else
          toast.success(
            warnings
              ? `Verify passed with ${warnings} warning${warnings === 1 ? '' : 's'}`
              : 'Verify passed'
          )
      },
      onError: () => {
        setVerifyStatus('unavailable')
        toast.error('Verify is unavailable right now — try again in a moment')
      },
    })
  }, [verify])

  return (
    <div
      role='toolbar'
      aria-label='Vehicle app actions'
      data-sv='action-bar'
      className='flex h-[36px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b bg-[var(--surface-1)] px-2'
    >
      {SV_ACTIONS.map((action) => {
        const ready = READY.has(action.id)
        const busy = action.id === 'verify' && verifyStatus === 'verifying'
        return (
          <Button
            key={action.id}
            variant='ghost'
            size='sm'
            disabled={!ready || busy || (action.id === 'verify' && !graphJson)}
            data-sv-action={action.id}
            aria-busy={busy || undefined}
            onClick={action.id === 'verify' ? onVerify : undefined}
            title={
              ready
                ? `${action.label} the workflow`
                : `${action.label} — available in ${action.milestone}`
            }
          >
            {busy ? 'Verifying…' : action.label}
          </Button>
        )
      })}
    </div>
  )
}
