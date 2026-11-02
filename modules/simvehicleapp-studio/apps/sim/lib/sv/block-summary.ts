/**
 * One-line summary of a vehicle block, from its props (ADR-0055, M16-T08): "When Speed goes above 120", "If
 * speed > 120 holds for 2 s", "Set Hazard.IsSignaling = true". It is drawn on the block so the logic reads off the
 * canvas without opening every block. Display only: the WorkflowGraph, IR and code never see it.
 *
 * Values are the raw subBlock values of the canvas (dropdown ids are strings, tables are `{ cells }` rows). A missing
 * value shows as `…`: the summary of a block being filled in is still a sentence.
 */

import { type SvMessageKey, svPlural, svT } from '@/lib/sv/i18n'
import { rfMotionLabel } from '@/blocks/robot'

/** What the block does in the flow; drawn as a small tag with the category colour. */
export type SvBlockRole = 'when' | 'if' | 'flow' | 'do' | 'send' | 'read' | 'calc' | 'state'

export interface SvBlockSummary {
  role: SvBlockRole
  text: string
}

type Values = Record<string, unknown>

const MAX = 64

const str = (v: unknown): string =>
  v === undefined || v === null || v === '' ? '…' : typeof v === 'string' ? v : JSON.stringify(v)

/** `Vehicle.Body.Lights.Hazard.IsSignaling` → `Hazard.IsSignaling`; `Vehicle.Speed` → `Speed`. */
export function shortPath(path: unknown): string {
  if (typeof path !== 'string' || !path) return '…'
  const parts = path.replace(/^Vehicle\./, '').split('.')
  return parts.slice(-2).join('.')
}

/** References of an expression as text: `<Vehicle.Speed> > 120` → `Speed > 120`, `<speed.value>` → `speed.value`. */
export function readable(expr: unknown): string {
  if (expr === undefined || expr === null || expr === '') return '…'
  const text = String(expr)
    .replace(/<(Vehicle\.[A-Za-z0-9_.]+)>/g, (_, p: string) => shortPath(p))
    .replace(/\bRobot\.[A-Za-z0-9_.]+/g, (p: string) => p.split('.').slice(-2).join('.'))
    .replace(/<([^<>]+)>/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

/** `500` → `500 ms`, `2000` → `2 s`, `1500` → `1.5 s`, `120000` → `2 min`. */
export function duration(ms: unknown): string {
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (ms === undefined || ms === null || ms === '' || !Number.isFinite(n)) return '…'
  if (n < 1000) return `${n} ms`
  if (n < 60_000) return `${Number((n / 1000).toFixed(1))} s`
  return `${Number((n / 60_000).toFixed(1))} min`
}

const rows = (v: unknown): number => (Array.isArray(v) ? v.length : 0)
/** Table rows with a non-empty `name` cell (the editor keeps an empty row to type into). */
const named = (v: unknown): number =>
  Array.isArray(v)
    ? v.filter((row) => {
        const name = (row as { cells?: Record<string, unknown> })?.cells?.name
        return typeof name === 'string' && name.trim().length > 0
      }).length
    : 0
const plural = (n: number, one: SvMessageKey, other: SvMessageKey) => svPlural(svT, n, one, other)

/** Cells of a table subBlock (`[{ cells: { value } }]`). */
const cells = (v: unknown, column: string): string[] =>
  Array.isArray(v)
    ? v.map((row) => readable((row as { cells?: Record<string, unknown> })?.cells?.[column]))
    : []

const SIGNAL_MODE: Record<string, SvMessageKey> = {
  any: 'sum.signal.any',
  rising: 'sum.signal.rising',
  falling: 'sum.signal.falling',
  crosses_above: 'sum.signal.crossesAbove',
  crosses_below: 'sum.signal.crossesBelow',
  becomes: 'sum.signal.becomes',
}

const UNARY_MATH = new Set(['abs', 'round', 'floor', 'ceil'])
const SEVERITY: Record<string, string> = { info: 'ℹ', warning: '⚠', critical: '‼' }
const FRESH = (v: Values) => (v.source === 'fresh-read' ? svT('sum.fresh') : '')

/** One rule per BlockSpec type (and per robot block); `block-summary.test.ts` fails when a spec has none. */
export const SV_SUMMARY_RULES: Record<string, (v: Values) => SvBlockSummary> = {
  sv_on_app_start: () => ({ role: 'when', text: svT('sum.sv_on_app_start') }),
  sv_on_signal_changed: (v) => {
    const key = SIGNAL_MODE[String(v.mode ?? 'any')] ?? SIGNAL_MODE.any
    const settle = Number(v.debounceMs) > 0 ? svT('sum.settled', { d: duration(v.debounceMs) }) : ''
    return {
      role: 'when',
      text: svT(key, { path: shortPath(v.path), t: str(v.threshold) }) + settle,
    }
  },
  sv_on_condition: (v) => ({
    role: 'when',
    text: svT('sum.sv_on_condition', { c: readable(v.expr) }),
  }),
  sv_on_timer: (v) => ({
    role: 'when',
    text:
      svT('sum.sv_on_timer', { d: duration(v.intervalMs) }) +
      (Number(v.initialDelayMs) > 0
        ? svT('sum.firstAfter', { d: duration(v.initialDelayMs) })
        : ''),
  }),
  sv_on_mqtt: (v) => ({ role: 'when', text: svT('sum.sv_on_mqtt', { topic: str(v.topic) }) }),

  sv_if: (v) => ({ role: 'if', text: svT('sum.sv_if', { c: readable(v.condition) }) }),
  sv_stable_for: (v) => ({
    role: 'if',
    text: svT('sum.sv_stable_for', { c: readable(v.condition), d: duration(v.durationMs) }),
  }),
  sv_switch: (v) => ({
    role: 'if',
    text: svT('sum.sv_switch', {
      v: readable(v.value),
      cases: plural(rows(v.cases), 'sum.cases.one', 'sum.cases.other'),
    }),
  }),
  sv_while: (v) => ({ role: 'if', text: svT('sum.sv_while', { c: readable(v.condition) }) }),
  sv_wait: (v) => ({ role: 'flow', text: svT('sum.sv_wait', { d: duration(v.durationMs) }) }),
  sv_wait_until: (v) => ({
    role: 'flow',
    text:
      svT('sum.sv_wait_until', { c: readable(v.condition) }) +
      (v.timeoutMs ? svT('sum.max', { d: duration(v.timeoutMs) }) : ''),
  }),
  sv_repeat: (v) => ({
    role: 'flow',
    text:
      svT('sum.sv_repeat', { n: str(v.count) }) +
      (v.intervalMs ? svT('sum.every', { d: duration(v.intervalMs) }) : ''),
  }),
  sv_parallel: (v) => ({
    role: 'flow',
    text: svT(
      v.join === 'none'
        ? 'sum.sv_parallel.none'
        : v.join === 'any'
          ? 'sum.sv_parallel.any'
          : 'sum.sv_parallel.all'
    ),
  }),
  sv_stop: (v) => ({
    role: 'flow',
    text: svT(
      v.scope === 'app'
        ? 'sum.sv_stop.app'
        : v.scope === 'workflow'
          ? 'sum.sv_stop.workflow'
          : 'sum.sv_stop.run'
    ),
  }),

  sv_set_actuator: (v) => ({
    role: 'do',
    text:
      svT('sum.sv_set_actuator', { path: shortPath(v.path), v: readable(v.value) }) +
      (v.awaitAck === true || v.awaitAck === 'true' ? svT('sum.waitForIt') : ''),
  }),

  sv_read_signal: (v) => ({
    role: 'read',
    text: svT('sum.read', { path: shortPath(v.path) }) + FRESH(v),
  }),
  sv_read_attribute: (v) => ({ role: 'read', text: svT('sum.read', { path: shortPath(v.path) }) }),
  sv_battery_status: (v) => ({ role: 'read', text: svT('sum.sv_battery_status') + FRESH(v) }),
  sv_door_status: (v) => ({
    role: 'read',
    text: svT('sum.sv_door_status', { door: str(v.door ?? 'Row1.DriverSide') }) + FRESH(v),
  }),
  sv_climate_status: (v) => ({
    role: 'read',
    text: svT('sum.sv_climate_status', { station: str(v.station ?? 'Row1.Driver') }) + FRESH(v),
  }),

  sv_hmi_notify: (v) => ({
    role: 'send',
    text: `${SEVERITY[String(v.severity ?? 'info')] ?? 'ℹ'} HMI: ${readable(v.title)}`,
  }),
  sv_log: (v) => ({
    role: 'send',
    text: svT('sum.log', { level: str(v.level ?? 'info'), m: readable(v.message) }),
  }),
  sv_mqtt_publish: (v) => ({
    role: 'send',
    text: svT('sum.sv_mqtt_publish', { topic: str(v.topic) }),
  }),

  sv_compare: (v) => ({
    role: 'calc',
    text: `${readable(v.left)} ${str(v.op ?? '>')} ${readable(v.right)}`,
  }),
  sv_math: (v) => {
    const op = String(v.op ?? '+')
    if (UNARY_MATH.has(op)) return { role: 'calc', text: `${op}(${readable(v.a)})` }
    if (op === 'min' || op === 'max')
      return { role: 'calc', text: `${op}(${readable(v.a)}, ${readable(v.b)})` }
    return { role: 'calc', text: `${readable(v.a)} ${op} ${readable(v.b)}` }
  },
  sv_bool: (v) => {
    const op = String(v.op ?? 'and')
    const inputs = cells(v.inputs, 'value')
    if (op === 'not') return { role: 'calc', text: `not ${inputs[0] ?? '…'}` }
    return { role: 'calc', text: inputs.length ? inputs.join(` ${op} `) : `${op} of …` }
  },
  sv_clamp: (v) => ({
    role: 'calc',
    text: svT('sum.sv_clamp', { v: readable(v.value), min: readable(v.min), max: readable(v.max) }),
  }),
  sv_in_range: (v) => ({
    role: 'calc',
    text: svT(v.mode === 'hysteresis' ? 'sum.sv_in_range.hysteresis' : 'sum.sv_in_range', {
      v: readable(v.value),
      low: readable(v.low),
      high: readable(v.high),
    }),
  }),
  sv_scale: (v) => ({
    role: 'calc',
    text: svT('sum.sv_scale', {
      v: readable(v.value),
      inMin: str(v.inMin),
      inMax: str(v.inMax),
      outMin: str(v.outMin),
      outMax: str(v.outMax),
    }),
  }),
  sv_convert: (v) => ({
    role: 'calc',
    text: svT('sum.sv_convert', { v: readable(v.value), to: str(v.to) }),
  }),
  sv_constant: (v) => ({
    role: 'calc',
    text: `= ${str(v.value)}${v.type ? ` (${str(v.type)})` : ''}`,
  }),
  sv_expression: (v) => ({ role: 'calc', text: `= ${readable(v.expr)}` }),
  sv_lookup: (v) => ({
    role: 'calc',
    text: svT('sum.sv_lookup', {
      v: readable(v.value),
      rows: plural(rows(v.table), 'sum.rows.one', 'sum.rows.other'),
    }),
  }),
  sv_array_at: (v) => ({ role: 'calc', text: `${readable(v.array)}[${readable(v.index)}]` }),
  sv_array_contains: (v) => ({
    role: 'calc',
    text: svT('sum.sv_array_contains', { a: readable(v.array), v: readable(v.value) }),
  }),
  sv_array_length: (v) => ({
    role: 'calc',
    text: svT('sum.sv_array_length', { a: readable(v.array) }),
  }),

  sv_var_get: (v) => ({ role: 'state', text: svT('sum.sv_var_get', { name: str(v.name) }) }),
  sv_var_set: (v) => ({ role: 'state', text: `${str(v.name)} = ${readable(v.value)}` }),
  sv_counter: (v) => ({
    role: 'state',
    text:
      v.op === 'reset'
        ? svT('sum.sv_counter.reset', { name: str(v.name) })
        : `${str(v.name)} ${v.op === 'dec' ? '−' : '+'}= ${str(v.step ?? 1)}`,
  }),
  sv_filter: (v) => ({
    role: 'state',
    text:
      v.mode === 'exponential'
        ? svT('sum.sv_filter.exponential', { v: readable(v.value), a: str(v.alpha) })
        : svT(v.mode === 'median' ? 'sum.sv_filter.median' : 'sum.sv_filter.average', {
            v: readable(v.value),
            w: str(v.window),
          }),
  }),
  sv_state_machine: (v) => ({
    role: 'state',
    text: svT('sum.sv_state_machine', {
      name: str(v.name),
      transitions: plural(rows(v.transitions), 'sum.transitions.one', 'sum.transitions.other'),
    }),
  }),
  sv_on_call: () => ({ role: 'when', text: svT('sum.sv_on_call') }),
  sv_call_workflow: (v) => ({
    role: 'flow',
    text: svT('sum.sv_call_workflow', {
      args: plural(named(v.args), 'sum.arguments.one', 'sum.arguments.other'),
    }),
  }),

  /** SV: robot blocks (ADR-0068 Notes 2026-11-01): the same one-line reading as vehicle blocks. */
  rf_on_start: () => ({ role: 'when', text: svT('sum.rf_on_start') }),
  rf_on_condition: (v) => ({
    role: 'when',
    text:
      svT('sum.rf_on_condition', { c: readable(v.when) }) +
      (Number(v.forMs) > 0 ? svT('sum.for', { d: duration(v.forMs) }) : ''),
  }),
  rf_every: (v) => ({ role: 'when', text: svT('sum.rf_every', { d: duration(v.periodMs) }) }),
  rf_if: (v) => ({ role: 'if', text: svT('sum.sv_if', { c: readable(v.when) }) }),
  rf_wait: (v) => ({ role: 'flow', text: svT('sum.sv_wait', { d: duration(v.ms) }) }),
  rf_wait_until: (v) => ({
    role: 'flow',
    text:
      svT('sum.sv_wait_until', { c: readable(v.when) }) +
      (v.timeoutMs ? svT('sum.max', { d: duration(v.timeoutMs) }) : ''),
  }),
  rf_repeat: (v) => ({ role: 'flow', text: svT('sum.sv_repeat', { n: str(v.count) }) }),
  rf_end: () => ({ role: 'flow', text: svT('sum.rf_end') }),
  rf_log: (v) => ({
    role: 'send',
    text: svT('sum.log', { level: str(v.level ?? 'info'), m: readable(v.message) }),
  }),
  rf_arm: () => ({ role: 'do', text: svT('sum.rf_arm') }),
  rf_disarm: () => ({ role: 'do', text: svT('sum.rf_disarm') }),
  rf_stop: () => ({ role: 'do', text: svT('sum.rf_stop') }),
  rf_reset_stop: () => ({ role: 'do', text: svT('sum.rf_reset_stop') }),
  rf_move: (v) => ({
    role: 'do',
    text: svT('sum.rf_move', { x: str(v.linear), z: str(v.angular), d: duration(v.durationMs) }),
  }),
  rf_perform: (v) => ({
    role: 'do',
    text: svT('sum.rf_perform', { motion: v.name ? rfMotionLabel(String(v.name)) : '…' }),
  }),
  rf_go_to: (v) => ({ role: 'do', text: svT('sum.rf_go_to', { x: str(v.x), y: str(v.y) }) }),
  rf_follow_route: (v) => ({
    role: 'do',
    text: svT('sum.rf_follow_route', {
      points: plural(
        String(v.waypoints ?? '')
          .split(';')
          .filter((p) => p.trim()).length,
        'sum.points.one',
        'sum.points.other'
      ),
    }),
  }),
}

/** Summary of a block on the canvas, or `null` for a block that is neither a vehicle nor a robot block. */
export function blockSummary(type: string, values: Values): SvBlockSummary | null {
  const rule = SV_SUMMARY_RULES[type]
  if (!rule) return null
  const s = rule(values)
  return s.text.length > MAX ? { ...s, text: `${s.text.slice(0, MAX - 1)}…` } : s
}
