/**
 * One-line summary of a vehicle block, from its props (ADR-0055, M16-T08): "When Speed goes above 120", "If
 * speed > 120 holds for 2 s", "Set Hazard.IsSignaling = true". It is drawn on the block so the logic reads off the
 * canvas without opening every block. Display only: the WorkflowGraph, IR and code never see it.
 *
 * Values are the raw subBlock values of the canvas (dropdown ids are strings, tables are `{ cells }` rows). A missing
 * value shows as `…`: the summary of a block being filled in is still a sentence.
 */

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
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Cells of a table subBlock (`[{ cells: { value } }]`). */
const cells = (v: unknown, column: string): string[] =>
  Array.isArray(v)
    ? v.map((row) => readable((row as { cells?: Record<string, unknown> })?.cells?.[column]))
    : []

const SIGNAL_MODE: Record<string, (path: string, threshold: string) => string> = {
  any: (p) => `When ${p} changes`,
  rising: (p) => `When ${p} rises`,
  falling: (p) => `When ${p} falls`,
  crosses_above: (p, t) => `When ${p} goes above ${t}`,
  crosses_below: (p, t) => `When ${p} goes below ${t}`,
  becomes: (p, t) => `When ${p} becomes ${t}`,
}

const UNARY_MATH = new Set(['abs', 'round', 'floor', 'ceil'])
const SEVERITY: Record<string, string> = { info: 'ℹ', warning: '⚠', critical: '‼' }
const FRESH = (v: Values) => (v.source === 'fresh-read' ? ' (fresh)' : '')

/** One rule per BlockSpec type; `block-summary.test.ts` fails when a spec has none. */
export const SV_SUMMARY_RULES: Record<string, (v: Values) => SvBlockSummary> = {
  sv_on_app_start: () => ({ role: 'when', text: 'When the app starts' }),
  sv_on_signal_changed: (v) => {
    const rule = SIGNAL_MODE[String(v.mode ?? 'any')] ?? SIGNAL_MODE.any
    const settle = Number(v.debounceMs) > 0 ? ` (settled ${duration(v.debounceMs)})` : ''
    return { role: 'when', text: rule(shortPath(v.path), str(v.threshold)) + settle }
  },
  sv_on_condition: (v) => ({ role: 'when', text: `When ${readable(v.expr)} becomes true` }),
  sv_on_timer: (v) => ({
    role: 'when',
    text: `Every ${duration(v.intervalMs)}${Number(v.initialDelayMs) > 0 ? `, first after ${duration(v.initialDelayMs)}` : ''}`,
  }),
  sv_on_mqtt: (v) => ({ role: 'when', text: `When MQTT ${str(v.topic)} arrives` }),

  sv_if: (v) => ({ role: 'if', text: `If ${readable(v.condition)}` }),
  sv_stable_for: (v) => ({
    role: 'if',
    text: `If ${readable(v.condition)} holds for ${duration(v.durationMs)}`,
  }),
  sv_switch: (v) => ({
    role: 'if',
    text: `Switch on ${readable(v.value)} · ${plural(rows(v.cases), 'case')}`,
  }),
  sv_while: (v) => ({ role: 'if', text: `While ${readable(v.condition)}` }),
  sv_wait: (v) => ({ role: 'flow', text: `Wait ${duration(v.durationMs)}` }),
  sv_wait_until: (v) => ({
    role: 'flow',
    text: `Wait until ${readable(v.condition)}${v.timeoutMs ? ` (max ${duration(v.timeoutMs)})` : ''}`,
  }),
  sv_repeat: (v) => ({
    role: 'flow',
    text: `Repeat ${str(v.count)} times${v.intervalMs ? `, every ${duration(v.intervalMs)}` : ''}`,
  }),
  sv_parallel: (v) => ({
    role: 'flow',
    text:
      v.join === 'none'
        ? 'Run in parallel, without waiting'
        : `Run in parallel, continue when ${v.join === 'any' ? 'one' : 'all'} finish${v.join === 'any' ? 'es' : ''}`,
  }),
  sv_stop: (v) => ({
    role: 'flow',
    text:
      v.scope === 'app'
        ? 'Stop the app'
        : v.scope === 'workflow'
          ? 'Stop this workflow'
          : 'Stop this run',
  }),

  sv_set_actuator: (v) => ({
    role: 'do',
    text: `Set ${shortPath(v.path)} = ${readable(v.value)}${v.awaitAck === true || v.awaitAck === 'true' ? ', wait for it' : ''}`,
  }),

  sv_read_signal: (v) => ({ role: 'read', text: `Read ${shortPath(v.path)}${FRESH(v)}` }),
  sv_read_attribute: (v) => ({ role: 'read', text: `Read ${shortPath(v.path)}` }),
  sv_battery_status: (v) => ({ role: 'read', text: `Battery status${FRESH(v)}` }),
  sv_door_status: (v) => ({
    role: 'read',
    text: `Door ${str(v.door ?? 'Row1.DriverSide')} status${FRESH(v)}`,
  }),
  sv_climate_status: (v) => ({
    role: 'read',
    text: `Climate ${str(v.station ?? 'Row1.Driver')} status${FRESH(v)}`,
  }),

  sv_hmi_notify: (v) => ({
    role: 'send',
    text: `${SEVERITY[String(v.severity ?? 'info')] ?? 'ℹ'} HMI: ${readable(v.title)}`,
  }),
  sv_log: (v) => ({ role: 'send', text: `Log ${str(v.level ?? 'info')}: ${readable(v.message)}` }),
  sv_mqtt_publish: (v) => ({ role: 'send', text: `Publish to ${str(v.topic)}` }),

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
    text: `Clamp ${readable(v.value)} to [${readable(v.min)}, ${readable(v.max)}]`,
  }),
  sv_in_range: (v) => ({
    role: 'calc',
    text:
      v.mode === 'hysteresis'
        ? `${readable(v.value)} between ${readable(v.low)} and ${readable(v.high)} (hysteresis)`
        : `${readable(v.value)} in [${readable(v.low)}, ${readable(v.high)}]`,
  }),
  sv_scale: (v) => ({
    role: 'calc',
    text: `Map ${readable(v.value)} from [${str(v.inMin)}, ${str(v.inMax)}] to [${str(v.outMin)}, ${str(v.outMax)}]`,
  }),
  sv_convert: (v) => ({ role: 'calc', text: `Convert ${readable(v.value)} to ${str(v.to)}` }),
  sv_constant: (v) => ({
    role: 'calc',
    text: `= ${str(v.value)}${v.type ? ` (${str(v.type)})` : ''}`,
  }),
  sv_expression: (v) => ({ role: 'calc', text: `= ${readable(v.expr)}` }),
  sv_lookup: (v) => ({
    role: 'calc',
    text: `Look up ${readable(v.value)} in ${plural(rows(v.table), 'row')}`,
  }),
  sv_array_at: (v) => ({ role: 'calc', text: `${readable(v.array)}[${readable(v.index)}]` }),
  sv_array_contains: (v) => ({
    role: 'calc',
    text: `${readable(v.array)} contains ${readable(v.value)}`,
  }),
  sv_array_length: (v) => ({ role: 'calc', text: `Length of ${readable(v.array)}` }),

  sv_var_get: (v) => ({ role: 'state', text: `Get ${str(v.name)}` }),
  sv_var_set: (v) => ({ role: 'state', text: `${str(v.name)} = ${readable(v.value)}` }),
  sv_counter: (v) => ({
    role: 'state',
    text:
      v.op === 'reset'
        ? `Reset ${str(v.name)}`
        : `${str(v.name)} ${v.op === 'dec' ? '−' : '+'}= ${str(v.step ?? 1)}`,
  }),
  sv_filter: (v) => ({
    role: 'state',
    text:
      v.mode === 'exponential'
        ? `Smooth ${readable(v.value)} (α ${str(v.alpha)})`
        : `${v.mode === 'median' ? 'Median' : 'Average'} of ${readable(v.value)} over ${str(v.window)}`,
  }),
  sv_state_machine: (v) => ({
    role: 'state',
    text: `State machine ${str(v.name)} · ${plural(rows(v.transitions), 'transition')}`,
  }),
  sv_on_call: () => ({ role: 'when', text: 'When another workflow calls this one' }),
  sv_call_workflow: (v) => ({
    role: 'flow',
    text: `Call a workflow · ${plural(named(v.args), 'argument')}`,
  }),
}

/** Summary of a block on the canvas, or `null` for a block that is not a vehicle block. */
export function blockSummary(type: string, values: Values): SvBlockSummary | null {
  const rule = SV_SUMMARY_RULES[type]
  if (!rule) return null
  const s = rule(values)
  return s.text.length > MAX ? { ...s, text: `${s.text.slice(0, MAX - 1)}…` } : s
}
