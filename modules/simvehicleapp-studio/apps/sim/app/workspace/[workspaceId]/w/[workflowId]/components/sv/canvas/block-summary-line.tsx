'use client'

import { memo } from 'react'
import { Badge } from '@/components/emcn'
import { blockSummary, type SvBlockRole } from '@/lib/sv/block-summary'

/** Tag and colour per role (ADR-0055): the category reads at a glance, with existing badge tokens. */
export const SV_ROLE_TAG = {
  when: { tag: 'WHEN', variant: 'purple' },
  if: { tag: 'IF', variant: 'amber' },
  flow: { tag: 'FLOW', variant: 'gray' },
  do: { tag: 'DO', variant: 'green' },
  send: { tag: 'SEND', variant: 'teal' },
  read: { tag: 'READ', variant: 'cyan' },
  calc: { tag: 'CALC', variant: 'gray-secondary' },
  state: { tag: 'STATE', variant: 'orange' },
} as const satisfies Record<SvBlockRole, { tag: string; variant: string }>

interface SvBlockSummaryLineProps {
  type: string
  values: Record<string, unknown>
}

/**
 * The sentence a vehicle block stands for, under its header ("WHEN Speed goes above 120"), so a workflow reads like
 * its logic (ADR-0055, M16-T08). Display only; nothing here is part of the graph. No `title` attribute: block
 * headers carry the block name as `title`, which E2E and tools use to find a block.
 */
export const SvBlockSummaryLine = memo(function SvBlockSummaryLine({
  type,
  values,
}: SvBlockSummaryLineProps) {
  const summary = blockSummary(type, values)
  if (!summary) return null
  const role = SV_ROLE_TAG[summary.role]
  return (
    <div
      data-sv='block-summary'
      data-sv-role={summary.role}
      className='flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--text-primary)]'
    >
      <Badge variant={role.variant} size='sm' className='shrink-0 font-medium'>
        {role.tag}
      </Badge>
      <span className='truncate'>{summary.text}</span>
    </div>
  )
})
