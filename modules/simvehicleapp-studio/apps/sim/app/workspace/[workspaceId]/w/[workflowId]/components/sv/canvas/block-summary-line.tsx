'use client'

import { memo } from 'react'
import { Badge } from '@/components/emcn'
import { blockSummary, type SvBlockRole } from '@/lib/sv/block-summary'
import { type SvMessageKey, svT } from '@/lib/sv/i18n'

/** Tag and colour per role (ADR-0055): the category reads at a glance, with existing badge tokens. */
export const SV_ROLE_TAG = {
  when: { tag: 'role.when', variant: 'purple' },
  if: { tag: 'role.if', variant: 'amber' },
  flow: { tag: 'role.flow', variant: 'gray' },
  do: { tag: 'role.do', variant: 'green' },
  send: { tag: 'role.send', variant: 'teal' },
  read: { tag: 'role.read', variant: 'cyan' },
  calc: { tag: 'role.calc', variant: 'gray-secondary' },
  state: { tag: 'role.state', variant: 'orange' },
} as const satisfies Record<SvBlockRole, { tag: SvMessageKey; variant: string }>

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
        {svT(role.tag)}
      </Badge>
      <span className='truncate'>{summary.text}</span>
    </div>
  )
})
