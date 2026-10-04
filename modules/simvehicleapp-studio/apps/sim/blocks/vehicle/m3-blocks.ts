import type { BlockConfig, SvHandle } from '@/blocks/types'
import { blockFromSpec } from '@/blocks/vehicle/factory'
import { SV_BLOCK_COLORS as C, SvIcons as I } from '@/blocks/vehicle/icons'

const CONCURRENCY = {
  restart: 'Restart the run',
  ignore: 'Ignore the event',
  queue: 'Queue it',
  parallel: 'Run in parallel',
}

/** `case-<i>` per row of the `cases` table, then `default` (BlockSpec `case`/`default`). */
function switchHandles(values: Record<string, unknown>): SvHandle[] {
  const rows = Array.isArray(values.cases)
    ? (values.cases as { cells?: Record<string, string> }[])
    : []
  return [
    ...rows.map((row, i) => ({ id: `case-${i}`, label: `= ${row.cells?.when || '…'}` })),
    { id: 'default', label: 'default' },
  ]
}

/** UI configs of the M3 BlockSpecs (M03-T07); semantics come from `block-specs.json`. */
export const SV_M3_BLOCKS: Record<string, BlockConfig> = {
  sv_on_app_start: blockFromSpec('sv_on_app_start', {
    name: 'When app starts',
    description: 'Start a run once when the vehicle app starts.',
    icon: I.appStart,
    bgColor: C.trigger,
  }),
  sv_on_timer: blockFromSpec('sv_on_timer', {
    name: 'Every …',
    description: 'Start a run at a fixed interval.',
    icon: I.timer,
    bgColor: C.trigger,
    props: {
      intervalMs: { title: 'Every' },
      initialDelayMs: { title: 'First run after', advanced: true },
      concurrency: { title: 'If still running', labels: CONCURRENCY, advanced: true },
    },
  }),
  sv_on_mqtt: blockFromSpec('sv_on_mqtt', {
    name: 'When MQTT message',
    description: 'Start a run when a message arrives on an MQTT topic.',
    icon: I.mqtt,
    bgColor: C.trigger,
    props: {
      topic: { title: 'Topic', placeholder: 'e.g. vehicle/commands/#' },
      payloadType: { title: 'Payload', labels: { text: 'Text', json: 'JSON' } },
      concurrency: { title: 'If still running', labels: CONCURRENCY, advanced: true },
    },
  }),
  sv_on_condition: blockFromSpec('sv_on_condition', {
    name: 'When condition becomes true',
    description: 'Start a run when a condition on vehicle signals turns true.',
    icon: I.condition,
    bgColor: C.trigger,
    props: {
      expr: { title: 'Condition', placeholder: 'e.g. <Vehicle.Speed> > 120 km/h' },
      debounceMs: { title: 'Must hold for', advanced: true },
      concurrency: { title: 'If still running', labels: CONCURRENCY, advanced: true },
    },
  }),
  sv_compare: blockFromSpec('sv_compare', {
    name: 'Compare',
    description: 'Compare two values.',
    icon: I.compare,
    bgColor: C.logic,
    props: { left: { title: 'Left' }, op: { title: 'Is' }, right: { title: 'Right' } },
  }),
  sv_bool: blockFromSpec('sv_bool', {
    name: 'And / Or / Not / Xor',
    description: 'Combine true/false values.',
    icon: I.logic,
    bgColor: C.logic,
    props: {
      op: { title: 'Operation', labels: { and: 'And', or: 'Or', not: 'Not', xor: 'Xor' } },
      inputs: { title: 'Values' },
    },
  }),
  sv_math: blockFromSpec('sv_math', {
    name: 'Math',
    description: 'Arithmetic on numbers.',
    icon: I.math,
    bgColor: C.logic,
    props: { op: { title: 'Operation' }, a: { title: 'A' }, b: { title: 'B' } },
  }),
  sv_expression: blockFromSpec('sv_expression', {
    name: 'Expression',
    description: 'Compute a value with an expression.',
    icon: I.expression,
    bgColor: C.logic,
    props: {
      expr: { title: 'Expression', placeholder: 'e.g. clamp(<Vehicle.Speed> / 2, 0, 100)' },
    },
  }),
  sv_constant: blockFromSpec('sv_constant', {
    name: 'Constant',
    description: 'A fixed value of a chosen type.',
    icon: I.constant,
    bgColor: C.logic,
  }),
  sv_scale: blockFromSpec('sv_scale', {
    name: 'Map range',
    description: 'Map a value from one range to another.',
    icon: I.math,
    bgColor: C.logic,
    props: {
      inMin: { title: 'From min' },
      inMax: { title: 'From max' },
      outMin: { title: 'To min' },
      outMax: { title: 'To max' },
      clamp: { title: 'Keep within the target range' },
    },
  }),
  sv_clamp: blockFromSpec('sv_clamp', {
    name: 'Clamp',
    description: 'Keep a value between a minimum and a maximum.',
    icon: I.math,
    bgColor: C.logic,
  }),
  sv_in_range: blockFromSpec('sv_in_range', {
    name: 'In range / Hysteresis',
    description: 'Check a value against limits, optionally with hysteresis.',
    icon: I.compare,
    bgColor: C.logic,
    props: { mode: { title: 'Mode', labels: { range: 'In range', hysteresis: 'Hysteresis' } } },
  }),
  sv_lookup: blockFromSpec('sv_lookup', {
    name: 'Lookup table',
    description: 'Pick a result from a table of cases.',
    icon: I.logic,
    bgColor: C.logic,
    props: { table: { title: 'Cases' } },
  }),
  sv_convert: blockFromSpec('sv_convert', {
    name: 'Convert unit/type',
    description: 'Convert a value to another unit or type.',
    icon: I.math,
    bgColor: C.logic,
    props: { to: { title: 'To', placeholder: 'e.g. m/s, fahrenheit, uint8' } },
  }),
  sv_array_length: blockFromSpec('sv_array_length', {
    name: 'Array length',
    description: 'Number of elements of an array signal.',
    icon: I.array,
    bgColor: C.logic,
  }),
  sv_array_at: blockFromSpec('sv_array_at', {
    name: 'Array element at',
    description: 'One element of an array signal (safe when out of range).',
    icon: I.array,
    bgColor: C.logic,
    props: { default: { title: 'If out of range' } },
  }),
  sv_array_contains: blockFromSpec('sv_array_contains', {
    name: 'Array contains',
    description: 'Whether an array signal contains a value.',
    icon: I.array,
    bgColor: C.logic,
  }),
  sv_if: blockFromSpec('sv_if', {
    name: 'If / Else',
    description: 'Continue on one of two paths.',
    icon: I.branch,
    bgColor: C.flow,
    handles: [
      { id: 'then', label: 'then' },
      { id: 'else', label: 'else' },
    ],
  }),
  sv_switch: blockFromSpec('sv_switch', {
    name: 'Switch',
    description: 'Continue on the path of the first matching case.',
    icon: I.branch,
    bgColor: C.flow,
    props: { cases: { title: 'Cases' } },
    handles: switchHandles,
  }),
  sv_wait: blockFromSpec('sv_wait', {
    name: 'Wait',
    description: 'Pause this run for a while.',
    icon: I.wait,
    bgColor: C.flow,
    props: { durationMs: { title: 'Wait for' } },
    handles: [{ id: 'source', label: 'then' }],
  }),
  sv_wait_until: blockFromSpec('sv_wait_until', {
    name: 'Wait until',
    description: 'Pause until a condition is true, or give up after a timeout.',
    icon: I.wait,
    bgColor: C.flow,
    props: { timeoutMs: { title: 'Give up after' } },
    handles: [
      { id: 'ok', label: 'ok' },
      { id: 'timeout', label: 'timeout' },
    ],
  }),
  sv_stable_for: blockFromSpec('sv_stable_for', {
    name: 'Stable for',
    description: 'Continue only if a condition stays true for a duration.',
    icon: I.stable,
    bgColor: C.flow,
    props: {
      condition: { placeholder: 'Empty = the trigger value does not change' },
      durationMs: { title: 'For' },
    },
    handles: [
      { id: 'stable', label: 'stable' },
      { id: 'broken', label: 'broken' },
    ],
  }),
  sv_stop: blockFromSpec('sv_stop', {
    name: 'Stop',
    description: 'Stop this run, the workflow or the whole app.',
    icon: I.stop,
    bgColor: C.flow,
    props: { scope: { labels: { run: 'This run', workflow: 'Workflow', app: 'App' } } },
    handles: [],
  }),
  sv_var_get: blockFromSpec('sv_var_get', {
    name: 'Get variable',
    description: 'Read a workflow variable.',
    icon: I.variable,
    bgColor: C.state,
    props: { name: { title: 'Variable' } },
  }),
  sv_var_set: blockFromSpec('sv_var_set', {
    name: 'Set variable',
    description: 'Change a workflow variable.',
    icon: I.variable,
    bgColor: C.state,
    props: { name: { title: 'Variable' } },
  }),
  sv_counter: blockFromSpec('sv_counter', {
    name: 'Counter',
    description: 'Increase, decrease or reset a counter variable.',
    icon: I.variable,
    bgColor: C.state,
    props: {
      name: { title: 'Variable' },
      op: { title: 'Action', labels: { inc: 'Increase', dec: 'Decrease', reset: 'Reset' } },
    },
  }),
  sv_log: blockFromSpec('sv_log', {
    name: 'Log',
    description: 'Write a line to the app log.',
    icon: I.log,
    bgColor: C.comm,
    props: { message: { placeholder: 'e.g. Speed is <Vehicle.Speed>' } },
  }),
  sv_mqtt_publish: blockFromSpec('sv_mqtt_publish', {
    name: 'Publish MQTT',
    description: 'Send a message to an MQTT topic.',
    icon: I.publish,
    bgColor: C.comm,
    props: {
      payloadType: { title: 'Payload format', labels: { text: 'Text', json: 'JSON' } },
      qos: { title: 'QoS', advanced: true },
      retain: { title: 'Retain', advanced: true },
    },
  }),
  sv_hmi_notify: blockFromSpec('sv_hmi_notify', {
    name: 'HMI notification',
    description: 'Show a notification on the vehicle HMI (via MQTT).',
    icon: I.hmi,
    bgColor: C.comm,
    props: { severity: { labels: { info: 'Info', warning: 'Warning', critical: 'Critical' } } },
  }),
}
