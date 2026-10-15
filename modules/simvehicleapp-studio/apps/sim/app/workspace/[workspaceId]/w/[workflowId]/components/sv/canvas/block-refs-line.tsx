'use client'

import { memo } from 'react'
import { blockRefs } from '@/lib/sv/block-refs'
import { useSvCanvasHighlightStore } from '@/stores/sv/canvas-highlight/store'

interface SvBlockRefsLineProps {
  values: Record<string, unknown>
}

/**
 * "uses: speedchanged.value" — the outputs of other blocks this block reads (ADR-0055, M16-T09). Pointing at a chip
 * highlights the block it comes from, so data flow is visible next to the control-flow edges.
 */
export const SvBlockRefsLine = memo(function SvBlockRefsLine({ values }: SvBlockRefsLineProps) {
  const refs = blockRefs(values)
  if (refs.length === 0) return null
  const highlight = useSvCanvasHighlightStore.getState().highlight
  return (
    <div data-sv='block-refs' className='flex min-w-0 flex-wrap items-center gap-1 text-[11px]'>
      <span className='text-[var(--text-muted)]'>uses:</span>
      {refs.slice(0, 3).map((ref) => (
        <span
          key={ref.text}
          data-sv-ref={ref.block}
          onMouseEnter={() => highlight(ref.block)}
          onMouseLeave={() => highlight(null)}
          className='max-w-[180px] truncate rounded-[4px] bg-[var(--surface-5)] px-1 font-mono text-[var(--text-secondary)]'
        >
          {ref.text}
        </span>
      ))}
      {refs.length > 3 && <span className='text-[var(--text-muted)]'>+{refs.length - 3}</span>}
    </div>
  )
})
