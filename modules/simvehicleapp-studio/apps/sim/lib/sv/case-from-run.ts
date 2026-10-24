import type { SvScenario } from '@/lib/api/contracts/sv'
import type { FlowRun, FlowSignal } from '@/lib/sv/flow-trace'

/**
 * "Make test case from this run" (ADR-0062 §4, M19-T06): a run seen in Simulate or Live becomes a test case that
 * locks what it did — the inputs that led to it, every write up to its end (each within 300 ms, so the case also
 * passes when played on the vehicle stack), and `never` for the actuators the workflow can write but did not.
 */

/** On the vehicle stack a write lands a little after its time (as recorded cases, ADR-0058 §9). */
export const CASE_WITHIN_MS = 300
/** Room after the last write before the case ends. */
const TAIL_MS = 1000
const MAX_T = 86_400_000

type Value = SvScenario['inputs'][number]['value']
const clampT = (t: number) => Math.min(MAX_T, Math.max(0, Math.round(t)))
const untilAfter = (t: number) =>
  Math.min(MAX_T, Math.max(1000, Math.ceil((t + TAIL_MS) / 1000) * 1000))

function lock(
  base: Pick<SvScenario, 'name' | 'initial' | 'inputs'>,
  writes: { t: number; path: string; value: unknown }[],
  end: number,
  writable: readonly string[]
): SvScenario {
  const written = new Set(writes.map((w) => w.path))
  const never = [...new Set(writable)].filter((p) => !written.has(p)).sort()
  const until = untilAfter(end)
  const expect = {
    ...(writes.length
      ? {
          writes: writes.map((w) => ({
            t: clampT(w.t),
            path: w.path,
            value: w.value as Value,
            within: CASE_WITHIN_MS,
          })),
        }
      : {}),
    ...(never.length ? { never: never.map((path) => ({ path, to: until })) } : {}),
  }
  return {
    scenarioVersion: '1.1.0',
    name: base.name,
    until,
    ...(base.initial && Object.keys(base.initial).length ? { initial: base.initial } : {}),
    inputs: base.inputs,
    ...(Object.keys(expect).length ? { expect } : {}),
  }
}

/**
 * From a simulated run: the simulated scenario up to the run's end (its initial values and the inputs until then),
 * with the writes the simulation made up to then.
 */
export function caseFromSimulatedRun(
  scenario: SvScenario,
  run: FlowRun,
  writes: readonly { ts: number; path: string; value: unknown }[],
  writable: readonly string[],
  name: string
): SvScenario {
  const end = run.endedAt ?? run.startedAt
  return lock(
    { name, initial: scenario.initial, inputs: scenario.inputs.filter((i) => i.t <= end) },
    writes.filter((w) => w.ts <= end).map((w) => ({ t: w.ts, path: w.path, value: w.value })),
    end,
    writable
  )
}

/** The value fired with at 1 s (time to settle); the case's clock starts this long before the cause. */
const LEAD_MS = 1000

/**
 * From a live run: the other watched signals as they were just before it (initial), the signal change that fired it
 * (input at 1 s), and what the run wrote, on the case's clock.
 */
export function caseFromLiveRun(
  run: FlowRun,
  signals: readonly FlowSignal[],
  writable: readonly string[],
  name: string
): SvScenario {
  const zero = (run.cause?.ts ?? run.trigger.ts) - LEAD_MS
  const initial: Record<string, Value> = {}
  for (const s of signals) {
    if (s.field === 'target' || s.ts >= zero + LEAD_MS) continue
    if (run.cause && s.path === run.cause.path && s.ts === run.cause.ts) continue
    initial[s.path] = s.value as Value
  }
  const writes = run.steps.flatMap((s) =>
    s.writes.map((w) => ({ t: w.ts - zero, path: w.path, value: w.value }))
  )
  const end = (run.endedAt ?? run.startedAt) - zero
  return lock(
    {
      name,
      initial,
      inputs: run.cause
        ? [{ t: LEAD_MS, path: run.cause.path, value: run.cause.value as Value }]
        : [],
    },
    writes,
    end,
    writable
  )
}

/** Actuators the workflow can write: the paths of its Set blocks. */
export function writablePaths(
  blocks: readonly { type: string; props?: Record<string, unknown> }[]
): string[] {
  return [
    ...new Set(
      blocks.flatMap((b) =>
        b.type === 'sv_set_actuator' && typeof b.props?.path === 'string' ? [b.props.path] : []
      )
    ),
  ].sort()
}
