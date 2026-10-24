/**
 * Flow of a workflow (ADR-0062 §1, M19-T03): the trace of a Simulate, a test case or a live run as the runs of its
 * triggers — each run the trigger that fired, what caused it (a signal change and where it came from), then every
 * block it went through in order: the branch it took and why (`data.eval`), how long it took, what it wrote, logged
 * or published. One model for every place that shows a run; pure and deterministic.
 */

export interface FlowTraceEvent {
  ts: number
  ev: string
  wf?: string
  run?: number
  node?: string
  blockId?: string
  data?: Record<string, unknown>
}

export interface FlowSignal {
  path: string
  ts: number
  value: unknown
  field?: string
  /** Where the value came from (ADR-0062 §3): inject, playback, mirror, app, vehicle. */
  source?: string
}

export interface FlowEval {
  refs: Record<string, unknown>
  result: unknown
}

export interface FlowStep {
  blockId: string
  node: string
  enteredAt: number
  exitedAt?: number
  /** The branch it left by (then, else, stable, timeout, case_1…); none for a block that does not decide. */
  handle?: string
  eval?: FlowEval
  writes: { ts: number; path: string; value: unknown }[]
  /** Logs and MQTT publishes, as text. */
  values: { kind: 'log' | 'mqtt'; text: string }[]
  error?: { reason: string; message?: string }
  /** Events merged by trace sampling (ADR-0027 §5): this step stands for more runs than shown. */
  dropped?: number
}

export type FlowOutcome = 'running' | 'done' | 'cancelled' | 'error'

export interface FlowRun {
  key: string
  wf: string
  run: number
  trigger: { blockId: string; node: string; ts: number; outputs: Record<string, unknown> }
  /** The signal change that fired it, when one matches (value and time). */
  cause?: { path: string; value: unknown; ts: number; source?: string }
  steps: FlowStep[]
  outcome: FlowOutcome
  startedAt: number
  endedAt?: number
}

export interface FlowResult {
  /** Newest first. */
  runs: FlowRun[]
  /** Older runs left out (`limit`). */
  hidden: number
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** A signal update counts as a trigger's cause within this window before it. */
const CAUSE_WINDOW_MS = 1000

export function flowRuns(
  trace: readonly FlowTraceEvent[],
  signals: readonly FlowSignal[] = [],
  limit = 200
): FlowResult {
  const runs = new Map<string, FlowRun>()
  const order: string[] = []
  for (const e of trace) {
    if (e.run === undefined || !e.wf || !e.node) continue
    const key = `${e.wf}:${e.run}`
    let run = runs.get(key)
    if (e.ev === 'trigger') {
      run = {
        key,
        wf: e.wf,
        run: e.run,
        trigger: {
          blockId: e.blockId ?? e.node,
          node: e.node,
          ts: e.ts,
          outputs: ((e.data as { outputs?: Record<string, unknown> } | undefined)?.outputs ??
            {}) as Record<string, unknown>,
        },
        steps: [],
        outcome: 'running',
        startedAt: e.ts,
      }
      runs.set(key, run)
      order.push(key)
      continue
    }
    if (!run) continue
    const open = () =>
      [...run.steps].reverse().find((s) => s.node === e.node && s.exitedAt === undefined)
    const last = () => [...run.steps].reverse().find((s) => s.node === e.node)
    switch (e.ev) {
      case 'enter':
        run.steps.push({
          blockId: e.blockId ?? e.node,
          node: e.node,
          enteredAt: e.ts,
          writes: [],
          values: [],
        })
        break
      case 'exit': {
        const s = open()
        if (!s) break
        s.exitedAt = e.ts
        const d = e.data ?? {}
        if (typeof d.handle === 'string' && d.handle !== 'next') s.handle = d.handle
        if (d.eval && typeof d.eval === 'object') s.eval = d.eval as FlowEval
        if (typeof d.dropped === 'number') s.dropped = d.dropped
        break
      }
      case 'write': {
        const s = open() ?? last()
        const d = e.data as { path?: string; value?: unknown } | undefined
        if (s && d?.path) s.writes.push({ ts: e.ts, path: d.path, value: d.value })
        break
      }
      case 'value': {
        const s = open() ?? last()
        const d = e.data as
          | { kind?: string; message?: string; topic?: string; payload?: string }
          | undefined
        if (s && d?.kind === 'log') s.values.push({ kind: 'log', text: String(d.message ?? '') })
        if (s && d?.kind === 'mqtt')
          s.values.push({ kind: 'mqtt', text: `${d.topic ?? ''}: ${d.payload ?? ''}` })
        break
      }
      case 'error': {
        const s = open() ?? last()
        const d = e.data as { reason?: string; message?: string } | undefined
        if (s)
          s.error = {
            reason: String(d?.reason ?? 'error'),
            ...(d?.message ? { message: d.message } : {}),
          }
        run.outcome = 'error'
        run.endedAt = e.ts
        break
      }
      case 'cancel':
        run.outcome = 'cancelled'
        run.endedAt = e.ts
        break
    }
  }
  for (const run of runs.values()) {
    if (
      run.outcome === 'running' &&
      run.steps.length &&
      run.steps.every((s) => s.exitedAt !== undefined)
    ) {
      const last = run.steps[run.steps.length - 1]
      // Ended on a block with nowhere to go: done (a decision with an unconnected branch, or the end of the chain).
      run.outcome = 'done'
      run.endedAt = last?.exitedAt
    }
    run.cause = causeOf(run, signals)
  }
  const newest = order.map((k) => runs.get(k) as FlowRun).reverse()
  return { runs: newest.slice(0, limit), hidden: Math.max(0, newest.length - limit) }
}

/** The latest change of a signal just before the trigger with the value the trigger fired with. */
function causeOf(run: FlowRun, signals: readonly FlowSignal[]): FlowRun['cause'] {
  const value = run.trigger.outputs.value
  if (value === undefined) return undefined
  let best: FlowSignal | undefined
  for (const s of signals) {
    if (s.field && s.field !== 'value') continue
    if (s.ts > run.trigger.ts || run.trigger.ts - s.ts > CAUSE_WINDOW_MS || !same(s.value, value))
      continue
    if (!best || s.ts > best.ts) best = s
  }
  return best
    ? {
        path: best.path,
        value: best.value,
        ts: best.ts,
        ...(best.source ? { source: best.source } : {}),
      }
    : undefined
}

const shortValue = (v: unknown) => {
  const t = typeof v === 'string' ? JSON.stringify(v) : (JSON.stringify(v) ?? String(v))
  return t.length > 40 ? `${t.slice(0, 39)}…` : t
}

/** `Speed = 121, IsMoving = true ⇒ false`: the operands of a decision as text (VSS paths and refs shortened). */
export function evalText(e: FlowEval): string {
  const refs = Object.entries(e.refs).map(
    ([k, v]) =>
      `${k
        .replace(/^Vehicle\./, '')
        .split('.')
        .slice(-2)
        .join('.')} = ${shortValue(v)}`
  )
  return `${refs.join(', ')}${refs.length ? ' ⇒ ' : ''}${shortValue(e.result)}`
}

/** Words for where a signal value came from. */
export const SOURCE_TEXT: Record<string, string> = {
  inject: 'you injected',
  playback: 'test playback',
  mirror: 'simulated vehicle',
  app: 'written by the app',
  vehicle: 'from the vehicle',
}

/** Milliseconds a step took, or null while it runs. */
export const stepDuration = (s: FlowStep) =>
  s.exitedAt === undefined ? null : s.exitedAt - s.enteredAt
