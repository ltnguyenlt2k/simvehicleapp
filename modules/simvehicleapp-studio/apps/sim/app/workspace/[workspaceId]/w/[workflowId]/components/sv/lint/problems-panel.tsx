'use client'

import { CircleAlert, Info, TriangleAlert, Wrench } from 'lucide-react'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import type { SvLintStatus } from '@/stores/sv/lint/store'

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const
const TONE = {
  error: 'text-[var(--text-error)]',
  warning: 'text-[var(--warning)]',
  info: 'text-[var(--text-muted)]',
} as const

/** A one-click fix offered on a problem row (M04-T11). */
export interface ProblemFix {
  label: string
  run: () => void
}

interface ProblemsListProps {
  diagnostics: readonly SvDiagnostic[]
  status: SvLintStatus
  /** True when the list is a Verify result of the graph on the canvas (types and units included). */
  verified?: boolean
  blockName: (blockId: string) => string | undefined
  onSelect?: (blockId: string, field?: string) => void
  fixFor?: (diagnostic: SvDiagnostic) => ProblemFix | undefined
}

function summary(
  diagnostics: readonly SvDiagnostic[],
  status: SvLintStatus,
  verified: boolean
): string {
  if (status === 'unavailable' && !verified) return 'Checks unavailable — showing the last result'
  if (status === 'checking' && !verified) return 'Checking…'
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const notes = diagnostics.length - errors - warnings
  // Infos (unit assumed/converted…) are notes, not problems.
  const counts =
    errors + warnings === 0
      ? `No problems${notes ? ` (${notes} note${notes === 1 ? '' : 's'})` : ''}`
      : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`
  return verified ? `Verified · ${counts}` : counts
}

/** Problems tab content (M03-T11, M04-T11): one row per diagnostic; click focuses the block field. */
export function ProblemsList({
  diagnostics,
  status,
  verified = false,
  blockName,
  onSelect,
  fixFor,
}: ProblemsListProps) {
  return (
    <div
      className='flex min-h-0 flex-1 flex-col'
      data-sv='problems'
      data-sv-verified={verified || undefined}
    >
      <p className='px-3 py-1 text-[var(--text-muted)] text-caption' aria-live='polite'>
        {summary(diagnostics, status, verified)}
      </p>
      <ul className='min-h-0 flex-1 overflow-y-auto px-1'>
        {diagnostics.map((d, i) => {
          const Icon = ICON[d.severity]
          const name = d.blockId ? blockName(d.blockId) : undefined
          const fix = fixFor?.(d)
          return (
            <li
              key={`${d.code}-${d.blockId ?? ''}-${d.field ?? ''}-${i}`}
              className='flex items-start gap-1'
            >
              <button
                type='button'
                data-sv-problem={d.code}
                data-sv-block={d.blockId}
                data-sv-field={d.field}
                disabled={!d.blockId || !onSelect}
                onClick={() => d.blockId && onSelect?.(d.blockId, d.field)}
                className='flex min-w-0 flex-1 items-start gap-2 rounded-sm px-2 py-1 text-left text-small hover-hover:bg-[var(--surface-5)] disabled:hover-hover:bg-transparent'
              >
                <Icon className={cn('mt-[3px] size-[14px] shrink-0', TONE[d.severity])} />
                <span className='min-w-0 flex-1 text-[var(--text-primary)]'>
                  {name && <span className='font-medium'>{name}: </span>}
                  {d.message}
                </span>
                <code className='shrink-0 text-[var(--text-muted)] text-caption'>{d.code}</code>
              </button>
              {fix && (
                <button
                  type='button'
                  data-sv-fix={d.code}
                  onClick={fix.run}
                  className='mt-[2px] flex shrink-0 items-center gap-1 rounded-sm px-2 py-[3px] text-[var(--text-primary)] text-caption hover-hover:bg-[var(--surface-5)]'
                >
                  <Wrench className='size-[12px] text-[var(--text-icon)]' />
                  {fix.label}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
