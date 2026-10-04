'use client'

import { Badge, Tooltip } from '@/components/emcn'
import { useSvLintStore } from '@/stores/sv/lint/store'

interface SvBlockProblemsBadgeProps {
  blockId: string
}

/** Lint badge in a block header (M03-T11): error count (red) or warning count (amber); info is not badged. */
export function SvBlockProblemsBadge({ blockId }: SvBlockProblemsBadgeProps) {
  const problems = useSvLintStore((s) => s.byBlock[blockId])
  if (!problems || (problems.errors === 0 && problems.warnings === 0)) return null
  const isError = problems.errors > 0
  const count = isError ? problems.errors : problems.warnings
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Badge
          variant={isError ? 'red' : 'amber'}
          dot
          data-sv='block-problems'
          data-sv-severity={isError ? 'error' : 'warning'}
          aria-label={`${count} ${isError ? 'error' : 'warning'}${count === 1 ? '' : 's'}`}
        >
          {count}
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>{problems.first}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
