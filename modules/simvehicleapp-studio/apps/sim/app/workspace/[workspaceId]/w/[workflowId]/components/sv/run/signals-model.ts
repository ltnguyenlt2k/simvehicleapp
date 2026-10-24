import type { SvScenario, SvSignalUpdate, SvVssNode } from '@/lib/api/contracts/sv'

const VSS_REF = /<(Vehicle(?:\.[A-Za-z0-9_]+)+)>/g

/** Every string inside a prop value (expressions, templates, nested lists). */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsOf)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsOf)
  return []
}

/**
 * Signal paths the workflow uses, sorted: the `path` of vehicle blocks and every `<Vehicle.…>` read in an expression
 * or template (M18-T05, ADR-0058 §6) — an If on `<Vehicle.Speed>` lists Speed even without a Read block.
 */
export function graphSignalPaths(graphJson: string | null): string[] {
  if (!graphJson) return []
  try {
    const graph = JSON.parse(graphJson) as { blocks?: { props?: Record<string, unknown> }[] }
    const paths = new Set<string>()
    for (const b of graph.blocks ?? []) {
      const path = b.props?.path
      if (typeof path === 'string' && path.startsWith('Vehicle')) paths.add(path)
      for (const text of stringsOf(b.props ?? {}))
        for (const m of text.matchAll(VSS_REF)) paths.add(m[1])
    }
    return [...paths].sort()
  } catch {
    return []
  }
}

/** What the user typed in an inject field: true/false, a number, a JSON array, else the text. */
export function parseSignalInput(text: string): SvScenario['inputs'][number]['value'] {
  const t = text.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && Number.isFinite(Number(t))) return Number(t)
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t) as unknown
      if (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) {
        return v as (string | number | boolean)[]
      }
    } catch {
      // not JSON: the text itself
    }
  }
  return text
}

export interface SignalValues {
  value?: SvSignalUpdate['value']
  target?: SvSignalUpdate['value']
  ts: number
}

/** Latest current value and target per path. */
export function applySignalUpdates(
  prev: Record<string, SignalValues>,
  updates: SvSignalUpdate[]
): Record<string, SignalValues> {
  const next = { ...prev }
  for (const u of updates) {
    const cur = next[u.path] ?? { ts: 0 }
    next[u.path] = { ...cur, [u.field]: u.value, ts: Math.max(cur.ts, u.ts) }
  }
  return next
}

export interface Recording {
  startedAt: number
  initial: Record<string, SvSignalUpdate['value']>
  inputs: { t: number; path: string; value: SvScenario['inputs'][number]['value'] }[]
  /** Actuator changes the app made while recording: proposed as the case's expectations (ADR-0058 §7). */
  observed?: { t: number; path: string; value: SvScenario['inputs'][number]['value'] }[]
}

/** On the vehicle stack a write lands a little after its time: tolerance of recorded expectations. */
const RECORDED_WITHIN_MS = 300

/**
 * Scenario of a recording: current values at the start, then each injected value at its time; what the app wrote
 * meanwhile becomes the expected writes (scenario 1.1, within 300 ms) — a proposal the user reviews in Test.
 */
export function recordingToScenario(rec: Recording, name: string): SvScenario {
  const observed = rec.observed ?? []
  const last = Math.max(rec.inputs.at(-1)?.t ?? 0, observed.at(-1)?.t ?? 0)
  const writes = observed.map((o) => ({
    t: Math.min(86_400_000, Math.max(0, Math.round(o.t) - RECORDED_WITHIN_MS)),
    path: o.path,
    value: o.value,
    within: RECORDED_WITHIN_MS,
  }))
  return {
    scenarioVersion: writes.length ? '1.1.0' : '1.0.0',
    ...(writes.length ? { expect: { writes } } : {}),
    name,
    until: Math.min(86_400_000, Math.max(1000, Math.ceil((last + 2000) / 1000) * 1000)),
    ...(Object.keys(rec.initial).length ? { initial: rec.initial } : {}),
    inputs: rec.inputs.map((i) => ({
      t: Math.min(86_400_000, Math.round(i.t)),
      path: i.path,
      value: i.value,
    })),
  }
}

export type SignalControl =
  | { kind: 'bool' }
  | { kind: 'enum'; options: string[] }
  | { kind: 'number'; unit?: string; min?: number; max?: number; integer: boolean }
  | { kind: 'text' }

/** What the inject row offers for a signal (M18-T05, ADR-0058 §6), from its catalog entry. */
export interface SignalInput {
  /** Sensors and attributes have only a value; an actuator's target is the request, its value the feedback. */
  fields: SvSignalUpdate['field'][]
  defaultField: SvSignalUpdate['field']
  control: SignalControl
}

const INTEGER = /^u?int(8|16|32|64)$/

export function signalInputOf(node: SvVssNode | undefined): SignalInput {
  const actuator = node?.kind === 'actuator'
  const fields: SvSignalUpdate['field'][] = !node
    ? ['value', 'target']
    : actuator
      ? ['target', 'value']
      : ['value']
  const dt = node?.datatype
  const control: SignalControl =
    dt === 'boolean'
      ? { kind: 'bool' }
      : node?.allowed?.length
        ? { kind: 'enum', options: node.allowed.map(String) }
        : dt && (INTEGER.test(dt) || dt === 'float' || dt === 'double')
          ? {
              kind: 'number',
              unit: node.unit,
              min: node.min,
              max: node.max,
              integer: INTEGER.test(dt),
            }
          : { kind: 'text' }
  return { fields, defaultField: fields[0], control }
}

/** A typed value to inject, or the reason it cannot be (checked again by the signal-gateway). */
export function typedValue(
  control: SignalControl,
  text: string
): { ok: true; value: SvScenario['inputs'][number]['value'] } | { ok: false; error: string } {
  if (control.kind === 'bool')
    return text === 'true' || text === 'false'
      ? { ok: true, value: text === 'true' }
      : { ok: false, error: 'true or false' }
  if (control.kind === 'enum')
    return control.options.includes(text)
      ? { ok: true, value: text }
      : { ok: false, error: `one of ${control.options.join(', ')}` }
  if (control.kind === 'number') {
    const n = Number(text.trim())
    if (text.trim() === '' || !Number.isFinite(n)) return { ok: false, error: 'a number' }
    if (control.integer && !Number.isInteger(n)) return { ok: false, error: 'a whole number' }
    if (control.min !== undefined && n < control.min)
      return { ok: false, error: `at least ${control.min}` }
    if (control.max !== undefined && n > control.max)
      return { ok: false, error: `at most ${control.max}` }
    return { ok: true, value: n }
  }
  return { ok: true, value: parseSignalInput(text) }
}

const MODE_HINT: Record<string, (threshold: unknown) => string> = {
  any: () => 'trigger: any change',
  rising: () => 'trigger: rises (false → true)',
  falling: () => 'trigger: falls (true → false)',
  crosses_above: (c) => `trigger: crosses above ${c}`,
  crosses_below: (c) => `trigger: crosses below ${c}`,
  becomes: (c) => `trigger: becomes ${c}`,
}

/** For each signal a trigger watches, the change that fires it (Live tab hint, ADR-0058 §6). */
export function triggerHints(graphJson: string | null): Map<string, string> {
  const out = new Map<string, string>()
  if (!graphJson) return out
  try {
    const graph = JSON.parse(graphJson) as {
      blocks?: { type?: string; props?: Record<string, unknown> }[]
    }
    for (const b of graph.blocks ?? []) {
      const path = b.props?.path
      if (b.type !== 'sv_on_signal_changed' || typeof path !== 'string') continue
      const hint = (MODE_HINT[String(b.props?.mode ?? 'any')] ?? MODE_HINT.any)(b.props?.threshold)
      out.set(path, out.has(path) ? `${out.get(path)}; ${hint}` : hint)
    }
  } catch {
    // an unreadable graph has no hint
  }
  return out
}
