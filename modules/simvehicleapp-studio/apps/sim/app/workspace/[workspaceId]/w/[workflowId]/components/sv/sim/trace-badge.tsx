'use client'

import { useMemo } from 'react'
import { Badge, Tooltip } from '@/components/emcn'
import { replayAt } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

interface SvTraceBadgeProps {
  blockId: string
}

/**
 * Replay overlay in a block header (M05-T10 TraceOverlay; reused for live runs in M8): what the block
 * was doing at the replay cursor. Shown only while the simulated graph is the one on the canvas.
 */
export function SvTraceBadge({ blockId }: SvTraceBadgeProps) {
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
