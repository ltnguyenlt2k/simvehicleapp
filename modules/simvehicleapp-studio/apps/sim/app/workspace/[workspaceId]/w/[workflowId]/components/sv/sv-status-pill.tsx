'use client'

import { Badge } from '@/components/emcn'
import type {
  SvPillTarget,
  SvStatusPill as SvStatusPillState,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-status'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

const VARIANT = { busy: 'blue', ok: 'green', error: 'red' } as const

/** Brings the dock tab of the pill forward. */
const SHOW: Record<SvPillTarget, () => void> = {
  problems: () => useSvLintStore.getState().showProblems(),
  simulation: () => useSvSimulationStore.getState().showSimulation(),
  'build-log': () => useSvSynCodeStore.getState().showBuildLog(),
  'run-console': () => useSvRunStore.getState().showRunConsole(),
}

interface SvStatusPillProps {
  pill: SvStatusPillState | null
}

/** What the workflow is doing or how its last action ended; a click opens the panel with the details (ADR-0054). */
export function SvStatusPill({ pill }: SvStatusPillProps) {
  if (!pill) return null
  return (
    <button
      type='button'
      data-sv='status-pill'
      data-sv-tone={pill.tone}
      onClick={SHOW[pill.target]}
      title='Show the details'
      className='shrink-0'
    >
      <Badge variant={VARIANT[pill.tone]} size='sm'>
        {pill.label}
      </Badge>
    </button>
  )
}
