import type { SvScenario } from '@/lib/api/contracts/sv'

/**
 * Generate tests (ADR-0058 §5/§10, design M18 §9.4): test cases derived from the workflow graph, deterministic — the
 * same graph always gives the same cases in the same order. For each signal trigger:
 * - its mode gives the change to make (`rising` false → true, `crosses_above c` c − step → c + step, …);
 * - each comparison `x op c` in a condition the trigger reaches gives the boundary values on both sides;
 * - a Stable for / Wait until reached adds a case that breaks the condition before its time is up.
 * The expectations come from the simulator afterwards (the cases are "lock the current behaviour" regression tests,
 * reviewed by the user before they are kept); `branchCoverage` measures which branches the cases ran.
 */

export interface GraphBlock {
  id: string
  type: string
  name: string
  props?: Record<string, unknown>
}

export interface GraphEdge {
  from: string
  fromHandle: string
  to: string
}

export interface Graph {
  blocks: GraphBlock[]
  edges: GraphEdge[]
}

export interface GeneratedCase {
  name: string
  scenario: SvScenario
}

/** Handles that pick one of several ways: each such edge is a branch to cover. */
const BRANCH_HANDLES = new Set(['then', 'else', 'stable', 'broken', 'ok', 'timeout', 'default'])
const isBranch = (handle: string) => BRANCH_HANDLES.has(handle) || /^case-/.test(handle)

const START_MS = 1000
const SETTLE_MS = 2000

interface Comparison {
  path: string
  op: '>' | '>=' | '<' | '<=' | '==' | '!='
  value: number
}

const normalize = (name: string) => name.toLowerCase().replace(/[\s.]+/g, '')

/** Block-output references `<blockname.value>` of signal triggers ⇒ the trigger's VSS path. */
function outputPaths(graph: Graph): Map<string, string> {
  const out = new Map<string, string>()
  for (const b of graph.blocks) {
    const path = b.props?.path
    if (b.type === 'sv_on_signal_changed' && typeof path === 'string')
      out.set(normalize(b.name), path)
  }
  return out
}

/** `<path> op number` and `number op <path>` in an expression (paths through trigger outputs too). */
export function comparisonsOf(expression: string, outputs: Map<string, string>): Comparison[] {
  const flip: Record<Comparison['op'], Comparison['op']> = {
    '>': '<',
    '>=': '<=',
    '<': '>',
    '<=': '>=',
    '==': '==',
    '!=': '!=',
  }
  const ref = (r: string) => {
    if (r.startsWith('Vehicle.')) return r
    const [block, field] = r.split('.')
    return field === 'value' ? outputs.get(normalize(block)) : undefined
  }
  const out: Comparison[] = []
  const num = '(-?\\d+(?:\\.\\d+)?)'
  const op = '(>=|<=|==|!=|>|<)'
  for (const m of expression.matchAll(new RegExp(`<([A-Za-z0-9_.]+)>\\s*${op}\\s*${num}`, 'g'))) {
    const path = ref(m[1])
    if (path) out.push({ path, op: m[2] as Comparison['op'], value: Number(m[3]) })
  }
  for (const m of expression.matchAll(new RegExp(`${num}\\s*${op}\\s*<([A-Za-z0-9_.]+)>`, 'g'))) {
    const path = ref(m[3])
    if (path) out.push({ path, op: flip[m[2] as Comparison['op']], value: Number(m[1]) })
  }
  return out
}

/** One step next to a boundary: 1 for integers, else 1 % of the value (at least 0.1). */
const stepOf = (c: number) => (Number.isInteger(c) ? 1 : Math.max(0.1, Math.abs(c) * 0.01))
const round = (x: number) => Math.round(x * 1000) / 1000

/** The value that makes `x op c` true, and the one next to it that makes it false. */
function sides(c: Comparison): { pass: number; fail: number } {
  const s = stepOf(c.value)
  switch (c.op) {
    case '>':
      return { pass: round(c.value + s), fail: c.value }
    case '>=':
      return { pass: c.value, fail: round(c.value - s) }
    case '<':
      return { pass: round(c.value - s), fail: c.value }
    case '<=':
      return { pass: c.value, fail: round(c.value + s) }
    case '==':
      return { pass: c.value, fail: round(c.value + s) }
    case '!=':
      return { pass: round(c.value + s), fail: c.value }
  }
}

/** Blocks a trigger reaches (any handle), in graph order. */
function reachable(graph: Graph, from: string): GraphBlock[] {
  const seen = new Set<string>([from])
  const queue = [from]
  while (queue.length) {
    const id = queue.shift() as string
    for (const e of graph.edges) {
      if (e.from === id && !seen.has(e.to)) {
        seen.add(e.to)
        queue.push(e.to)
      }
    }
  }
  return graph.blocks.filter((b) => seen.has(b.id) && b.id !== from)
}

const leaf = (path: string) => path.split('.').pop() ?? path

function scenario(
  name: string,
  until: number,
  initial: Record<string, unknown>,
  inputs: SvScenario['inputs']
): SvScenario {
  return {
    scenarioVersion: '1.1.0',
    name,
    until,
    initial: initial as SvScenario['initial'],
    inputs,
  }
}

/** Test cases of a graph (no expectations yet: Simulate fills them). */
export function generateTests(graph: Graph): GeneratedCase[] {
  const outputs = outputPaths(graph)
  const cases: GeneratedCase[] = []
  const add = (c: GeneratedCase) => {
    const key = JSON.stringify({ ...c.scenario, name: '' })
    if (!cases.some((x) => JSON.stringify({ ...x.scenario, name: '' }) === key)) cases.push(c)
  }
  for (const trigger of graph.blocks) {
    if (trigger.type === 'sv_on_app_start') {
      add({
        name: `${trigger.name}: the app starts`,
        scenario: scenario(trigger.name, START_MS + SETTLE_MS, {}, []),
      })
      continue
    }
    if (trigger.type !== 'sv_on_signal_changed') continue
    const path = trigger.props?.path
    if (typeof path !== 'string') continue
    const downstream = reachable(graph, trigger.id)
    const hold = Math.max(
      0,
      ...downstream.map((b) => Number(b.props?.durationMs ?? b.props?.timeoutMs ?? 0) || 0)
    )
    const until = START_MS + hold + SETTLE_MS
    const timed = downstream.some((b) => b.type === 'sv_stable_for' || b.type === 'sv_wait_until')
    const mode = String(trigger.props?.mode ?? 'any')
    const threshold = Number(trigger.props?.threshold)

    // The trigger's own change.
    if (mode === 'rising' || mode === 'falling') {
      const [from, to] = mode === 'rising' ? [false, true] : [true, false]
      add({
        name: `${leaf(path)} ${mode === 'rising' ? 'rises (false → true)' : 'falls (true → false)'}`,
        scenario: scenario(trigger.name, until, { [path]: from }, [
          { t: START_MS, path, value: to },
        ]),
      })
    } else if (
      (mode === 'crosses_above' || mode === 'crosses_below') &&
      Number.isFinite(threshold)
    ) {
      const s = stepOf(threshold)
      const [from, to] =
        mode === 'crosses_above'
          ? [round(threshold - s), round(threshold + s)]
          : [round(threshold + s), round(threshold - s)]
      add({
        name: `${leaf(path)} ${mode === 'crosses_above' ? 'crosses above' : 'crosses below'} ${threshold}`,
        scenario: scenario(trigger.name, until, { [path]: from }, [
          { t: START_MS, path, value: to },
        ]),
      })
    }

    // Both sides of every comparison the trigger reaches.
    for (const b of downstream) {
      const condition = b.props?.condition
      if (typeof condition !== 'string') continue
      for (const c of comparisonsOf(condition, outputs)) {
        const { pass, fail } = sides(c)
        const own = c.path === path
        const change = (value: number, base: number) =>
          own
            ? { initial: { [path]: base }, inputs: [{ t: START_MS, path, value }] }
            : // Another signal: set it first, then make the trigger fire.
              { initial: { [c.path]: value, [path]: 0 }, inputs: [{ t: START_MS, path, value: 1 }] }
        const label = `${leaf(c.path)} ${c.op} ${c.value}`
        const p = change(pass, fail)
        add({
          name: `${label}: ${pass} (${b.name} true)`,
          scenario: scenario(b.name, until, p.initial, p.inputs),
        })
        const f = change(fail, pass)
        add({
          name: `${label}: ${fail} (${b.name} false)`,
          scenario: scenario(b.name, until, f.initial, f.inputs),
        })
        if (timed && own && hold > 0) {
          add({
            name: `${label}: ${pass}, back to ${fail} after ${Math.round(hold / 2)} ms (${b.name} broken)`,
            scenario: scenario(b.name, until, { [path]: fail }, [
              { t: START_MS, path, value: pass },
              { t: START_MS + Math.round(hold / 2), path, value: fail },
            ]),
          })
        }
      }
    }
  }
  return cases
}

export interface Branch {
  from: string
  handle: string
  to: string
}

/** Branch edges of the graph (then/else, stable/broken, ok/timeout, case-n/default). */
export function branchesOf(graph: Graph): Branch[] {
  return graph.edges
    .filter((e) => isBranch(e.fromHandle))
    .map((e) => ({ from: e.from, handle: e.fromHandle, to: e.to }))
}

/** Branches whose target block one of the cases entered, and the total. */
export function branchCoverage(
  graph: Graph,
  enteredBlockIds: Iterable<string>
): { covered: Branch[]; missing: Branch[] } {
  const entered = new Set(enteredBlockIds)
  const all = branchesOf(graph)
  return {
    covered: all.filter((b) => entered.has(b.to)),
    missing: all.filter((b) => !entered.has(b.to)),
  }
}

/** Actuators the workflow writes (Set blocks): a case that writes none of them locks that with `never`. */
export function writablePaths(graph: Graph): string[] {
  const paths = graph.blocks.flatMap((b) =>
    b.type === 'sv_set_actuator' && typeof b.props?.path === 'string' ? [b.props.path] : []
  )
  return [...new Set(paths)].sort()
}

/**
 * Expectations of a case from its simulation — what the workflow does now: its writes and publishes at their exact
 * times, and `never` for each actuator of the workflow the case does not write.
 */
export function lockExpectations(
  sc: SvScenario,
  result: {
    writes: { t: number; path: string; value: unknown }[]
    publishes?: { t: number; topic: string; payload: string }[]
  },
  actuators: string[]
): SvScenario {
  const writes = result.writes.map((w) => ({
    t: w.t,
    path: w.path,
    value: w.value as SvScenario['inputs'][number]['value'],
  }))
  const publishes = (result.publishes ?? []).map((p) => ({
    t: p.t,
    topic: p.topic,
    payload: p.payload,
  }))
  const written = new Set(writes.map((w) => w.path))
  const never = actuators.filter((p) => !written.has(p)).map((path) => ({ path }))
  return {
    ...sc,
    scenarioVersion: '1.1.0',
    expect: {
      ...(writes.length ? { writes } : {}),
      ...(publishes.length ? { publishes } : {}),
      ...(never.length ? { never } : {}),
    },
  }
}
