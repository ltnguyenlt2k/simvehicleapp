'use client'

import { useMemo } from 'react'
import { useStore } from 'reactflow'
import { laneRegions } from '@/lib/sv/lane-layout'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Lanes on the canvas (ADR-0059 §3, M18-T08): a thin outlined region with the trigger's name around each trigger's
 * blocks, once the workflow reads in separate lanes (Auto layout). Drawn over the canvas without catching the pointer,
 * following the viewport; nothing when a workflow has one trigger or its flows overlap.
 */
export function SvLaneBackdrop() {
  const blocks = useWorkflowStore((s) => s.blocks)
  const edges = useWorkflowStore((s) => s.edges)
  const [tx, ty, zoom] = useStore((s) => s.transform)
  const regions = useMemo(() => laneRegions(blocks, edges), [blocks, edges])
  if (!regions.length) return null
  return (
    <div aria-hidden className='pointer-events-none absolute inset-0 z-[1] overflow-hidden'>
      {regions.map((r) => (
        <div
          key={r.triggerId}
          data-sv-lane={r.triggerId}
          className='absolute rounded-xl border border-[var(--border)] border-dashed'
          style={{
            left: tx + r.x * zoom,
            top: ty + r.y * zoom,
            width: r.width * zoom,
            height: r.height * zoom,
          }}
        >
          <span className='absolute top-1 left-2 truncate text-[var(--text-muted)] text-caption'>
            {r.name}
          </span>
        </div>
      ))}
    </div>
  )
}
