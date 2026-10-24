'use client'

import { sampleText } from '@/lib/sv/earlier-data'
import { type BlockFlow, type EdgeFlowState, edgeFlowState, flowAt } from '@/lib/sv/edge-flow'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

/** One flow map per trace and cursor, shared by every edge of the canvas. */
let cache: { trace: unknown; at: number; flow: Record<string, BlockFlow> } | null = null
function cachedFlow(
  trace: readonly Parameters<typeof flowAt>[0][number][],
  at: number,
  key: unknown
) {
  if (cache && cache.trace === key && cache.at === at) return cache.flow
  const flow = flowAt(trace, at)
  cache = { trace: key, at, flow }
  return flow
}

/**
 * Which way the workflow went on this edge (ADR-0059 §4): from the followed live run, else the Simulate replay at
 * its cursor (only while the simulated graph is the one on the canvas). `value` is set on edges leaving a trigger.
 */
export function useSvEdgeFlow(
  source: string,
  sourceHandle: string | null | undefined
): { state: EdgeFlowState; value: string | null } {
  const liveEntries = useSvRunStore((s) => (s.active ? s.entries : null))
  const result = useSvSimulationStore((s) => s.result)
  const cursor = useSvSimulationStore((s) => s.cursor)
  const simulatedGraph = useSvSimulationStore((s) => s.graphJson)
  const currentGraph = useSvLintStore((s) => s.graphJson)

  let flow: Record<string, BlockFlow> | null = null
  if (liveEntries?.length) {
    const events = liveEntries.flatMap((e) => (e.kind === 'trace' ? [e.event] : []))
    flow = cachedFlow(events, Number.POSITIVE_INFINITY, liveEntries)
  } else if (result && simulatedGraph === currentGraph) {
    flow = cachedFlow(result.trace, cursor, result.trace)
  }
  if (!flow) return { state: 'idle', value: null }
  const block = flow[source]
  const state = edgeFlowState(block, sourceHandle)
  return {
    state,
    value: state === 'taken' && block?.value !== undefined ? sampleText(block.value) : null,
  }
}
