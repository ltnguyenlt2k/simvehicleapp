'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, type LucideIcon, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

/** How long a finished action shows its ✓ / ✕ (ADR-0054). */
export const SV_ACTION_FLASH_MS = 3000

interface SvActionButtonProps {
  /** `data-sv-action` (E2E and the action bar rely on it). */
  action: string
  label: string
  icon: LucideIcon
  /** Label while busy (`Verifying…`); defaults to `label`. */
  busyLabel?: string
  busy?: boolean
  /** Outcome of the last run of the action, shown for a few seconds when `busy` ends. */
  outcome?: 'passed' | 'failed' | null
  /** The sensible next step of the workflow: drawn as the primary button. */
  primary?: boolean
  disabled?: boolean
  title: string
  onClick?: () => void
  /** Extra `data-*` attributes (run state…). */
  data?: Record<`data-${string}`, string | undefined>
}

/**
 * A button of the vehicle editor's action bar (ADR-0054, M16-T06): icon and label, a spinner and `aria-busy` while
 * the action runs (it cannot be pressed again), then ✓ or ✕ for {@link SV_ACTION_FLASH_MS}. The accessible name is
 * always the label, so E2E and screen readers find "SynCode", "Run"… whatever the state.
 */
export function SvActionButton({
  action,
  label,
  icon: Icon,
  busyLabel,
  busy = false,
  outcome = null,
  primary = false,
  disabled = false,
  title,
  onClick,
  data,
}: SvActionButtonProps) {
  const wasBusy = useRef(busy)
  const [flash, setFlash] = useState<'passed' | 'failed' | null>(null)

  useEffect(() => {
    const ended = wasBusy.current && !busy
    wasBusy.current = busy
    if (!ended || !outcome) return
    setFlash(outcome)
    const timer = setTimeout(() => setFlash(null), SV_ACTION_FLASH_MS)
    return () => clearTimeout(timer)
  }, [busy, outcome])

  const StateIcon = busy ? Loader2 : flash === 'passed' ? Check : flash === 'failed' ? X : Icon
  return (
    <Button
      variant={primary && !disabled ? 'primary' : 'ghost'}
      size='sm'
      data-sv-action={action}
      data-sv-primary={primary ? 'true' : undefined}
      data-sv-flash={flash ?? undefined}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onClick}
      title={title}
      className='gap-1.5'
      {...data}
    >
      <StateIcon
        aria-hidden
        className={cn(
          'size-[14px] shrink-0',
          busy && 'animate-spin',
          flash === 'passed' && 'text-[var(--text-success)]',
          flash === 'failed' && 'text-[var(--text-error)]'
        )}
      />
      {busy ? (busyLabel ?? label) : label}
    </Button>
  )
}
