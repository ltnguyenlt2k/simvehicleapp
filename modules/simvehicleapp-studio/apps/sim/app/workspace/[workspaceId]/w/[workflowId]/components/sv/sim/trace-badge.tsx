'use client'

import { useMemo } from 'react'
import { Badge, Tooltip } from '@/components/emcn'
import { replayAt } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

interface SvTraceBadgeProps {
  blockId: string
}

/**
 * Trace overlay in a block header: while a live run is active, what the block is doing in the app
 * (M08-T08, ADR-0027 §7); otherwise the Simulate replay at the cursor (M05-T10), shown only while
 * the simulated graph is the one on the canvas.
 */
export function SvTraceBadge({ blockId }: SvTraceBadgeProps) {
  const workflowId = useSvLintStore((s) => s.workflowId)
  const liveActive = useSvRunStore((s) => s.active)
  const live = useSvRunStore((s) => (workflowId ? s.blocks[workflowId]?.[blockId] : undefined))
  if (liveActive && live) return <LiveBadge state={live.state} runs={live.runs} last={live.last} />
  return <ReplayBadge blockId={blockId} />
}

interface LiveBadgeProps {
  state: 'running' | 'done' | 'error'
  runs: number
  last?: string
}

function LiveBadge({ state, runs, last }: LiveBadgeProps) {
  const label = state === 'running' ? 'running' : state === 'error' ? 'error' : `${runs}×`
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Badge
          variant={state === 'error' ? 'red' : state === 'running' ? 'blue' : 'green'}
          data-sv='trace-badge'
          data-sv-live={state}
          aria-label={`Live run: ${label}`}
        >
          {label}
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>
          {last ? `Live · last value: ${last}` : `Live · ran ${runs} time${runs === 1 ? '' : 's'}`}
        </span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

function ReplayBadge({ blockId }: SvTraceBadgeProps) {
  const result = useSvSimulationStore((s) => s.result)
  const cursor = useSvSimulationStore((s) => s.cursor)
  const simulatedGraph = useSvSimulationStore((s) => s.graphJson)
  const currentGraph = useSvLintStore((s) => s.graphJson)
  const replay = useMemo(
    () => (result ? replayAt(result.trace, cursor)[blockId] : undefined),
    [result, cursor, blockId]
  )
  if (!replay || simulatedGraph !== currentGraph) return null
  const label =
    replay.state === 'running' ? 'running' : replay.state === 'error' ? 'error' : `${replay.runs}×`
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Badge
          variant={replay.state === 'error' ? 'red' : replay.state === 'running' ? 'blue' : 'gray'}
          data-sv='trace-badge'
          data-sv-replay={replay.state}
          aria-label={`Simulation: ${label}`}
        >
          {label}
        </Badge>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className='text-sm'>
          {replay.last
            ? `Last value: ${replay.last}`
            : `Finished ${replay.runs} time${replay.runs === 1 ? '' : 's'}`}
        </span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
