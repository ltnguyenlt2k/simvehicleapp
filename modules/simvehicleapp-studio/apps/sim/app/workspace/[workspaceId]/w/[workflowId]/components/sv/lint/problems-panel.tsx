'use client'

import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import type { SvLintStatus } from '@/stores/sv/lint/store'

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const
const TONE = {
  error: 'text-[var(--text-error)]',
  warning: 'text-[var(--warning)]',
  info: 'text-[var(--text-muted)]',
} as const

interface ProblemsListProps {
  diagnostics: readonly SvDiagnostic[]
  status: SvLintStatus
  blockName: (blockId: string) => string | undefined
  onSelect?: (blockId: string) => void
}

/** Problems tab content (M03-T11): one row per diagnostic, click selects the block. */
export function ProblemsList({ diagnostics, status, blockName, onSelect }: ProblemsListProps) {
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  return (
    <div className='flex min-h-0 flex-1 flex-col' data-sv='problems'>
      <p className='px-3 py-1 text-[var(--text-muted)] text-caption' aria-live='polite'>
        {status === 'unavailable'
          ? 'Checks unavailable — showing the last result'
          : status === 'checking'
            ? 'Checking…'
            : diagnostics.length === 0
              ? 'No problems'
              : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}
      </p>
      <ul className='min-h-0 flex-1 overflow-y-auto px-1'>
        {diagnostics.map((d, i) => {
          const Icon = ICON[d.severity]
          const name = d.blockId ? blockName(d.blockId) : undefined
          return (
            <li key={`${d.code}-${d.blockId ?? ''}-${d.field ?? ''}-${i}`}>
              <button
                type='button'
                data-sv-problem={d.code}
                data-sv-block={d.blockId}
                disabled={!d.blockId || !onSelect}
                onClick={() => d.blockId && onSelect?.(d.blockId)}
                className='flex w-full items-start gap-2 rounded-sm px-2 py-1 text-left text-small hover-hover:bg-[var(--surface-5)] disabled:hover-hover:bg-transparent'
              >
                <Icon className={cn('mt-[3px] size-[14px] shrink-0', TONE[d.severity])} />
                <span className='min-w-0 flex-1 text-[var(--text-primary)]'>
                  {name && <span className='font-medium'>{name}: </span>}
                  {d.message}
                </span>
                <code className='shrink-0 text-[var(--text-muted)] text-caption'>{d.code}</code>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
