import type { SvScenario } from '@/lib/api/contracts/sv'
import { evalText, type FlowRun, type FlowTraceEvent, flowRuns } from '@/lib/sv/flow-trace'
import type { Graph } from '@/lib/sv/test-generate'

/**
 * Why a test case failed (ADR-0062 §4, M19-T06): for each expectation the run did not meet, the run that should have
 * met it and the first place it went another way — the decision that took the other branch (with the condition's
 * values) and the branch it needed, found by walking back from the Set block of the expected path to its trigger.
 * Pure and deterministic: the scenario, the simulator's trace and the graph in, sentences out.
 */

export interface FailExplanation {
  /** What was expected, as text. */
  expected: string
  /** Why it did not happen. */
  why: string
  /** Block to show on the canvas. */
  blockId?: string
  /** The run that should have met it. */
  run?: number
}

const shown = (v: unknown) => JSON.stringify(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

interface PathStep {
  /** A decision block on the way and the branch that leads on. */
  blockId: string
  handle: string
}

/** Ways from a trigger to `target`: the trigger, then the decisions passed with the handle taken (first found). */
function wayTo(graph: Graph, target: string): { trigger: string; decisions: PathStep[] } | null {
  const into = new Map<string, Graph['edges']>()
  for (const e of graph.edges) into.set(e.to, [...(into.get(e.to) ?? []), e])
  const seen = new Set<string>()
  const walk = (id: string): { trigger: string; decisions: PathStep[] } | null => {
    if (seen.has(id)) return null
    seen.add(id)
    const edges = into.get(id) ?? []
    if (!edges.length) return { trigger: id, decisions: [] }
    for (const e of edges) {
      const up = walk(e.from)
      if (!up) continue
      const branch = e.fromHandle && e.fromHandle !== 'source' && e.fromHandle !== 'next'
      return {
        trigger: up.trigger,
        decisions: branch
          ? [...up.decisions, { blockId: e.from, handle: e.fromHandle }]
          : up.decisions,
      }
    }
    return null
  }
  return walk(target)
}

/** Set blocks that write `path`, the one with the expected literal value first. */
function settersOf(graph: Graph, path: string, value: unknown) {
  const setters = graph.blocks.filter(
    (b) => b.props?.path === path && b.type !== 'sv_on_signal_changed'
  )
  return [...setters].sort(
    (a, b) => Number(!same(a.props?.value, value)) - Number(!same(b.props?.value, value))
  )
}

/** Where `run` left the way to the setter: the first decision that took another branch, or a block it never reached. */
function deviation(
  run: FlowRun,
  decisions: PathStep[],
  name: (id: string) => string
): Omit<FailExplanation, 'expected'> {
  for (const d of decisions) {
    const step = run.steps.find((s) => s.blockId === d.blockId)
    if (!step) {
      const why =
        run.outcome === 'cancelled'
          ? `run ${run.run} was cancelled before it reached ${name(d.blockId)} (a newer change restarted it)`
          : `run ${run.run} did not reach ${name(d.blockId)}`
      return { why, blockId: d.blockId, run: run.run }
    }
    if (step.exitedAt === undefined) {
      const why =
        run.outcome === 'cancelled'
          ? `${name(d.blockId)} was waiting when run ${run.run} was cancelled (a newer change restarted it)`
          : `${name(d.blockId)} was still waiting when the simulation ended`
      return { why, blockId: d.blockId, run: run.run }
    }
    if (step.handle !== d.handle) {
      const values = step.eval ? ` (${evalText(step.eval)})` : ''
      return {
        why: `${name(d.blockId)} took ${step.handle ?? 'no branch'}${values}; it needs ${d.handle}`,
        blockId: d.blockId,
        run: run.run,
      }
    }
  }
  return { why: `run ${run.run} took every branch needed but did not write it`, run: run.run }
}

export function explainFailures(
  scenario: SvScenario,
  trace: readonly FlowTraceEvent[],
  graph: Graph
): FailExplanation[] {
  const names = new Map(graph.blocks.map((b) => [b.id, b.name]))
  const name = (id: string) => names.get(id) ?? id
  const runs = flowRuns(trace, [], Number.MAX_SAFE_INTEGER).runs
  const writes = runs.flatMap((r) =>
    r.steps.flatMap((s) => s.writes.map((w) => ({ ...w, run: r.run, blockId: s.blockId })))
  )
  const out: FailExplanation[] = []
  const used = new Set<number>()

  for (const w of scenario.expect?.writes ?? []) {
    const within = w.within ?? 0
    const expected = `${w.path} = ${shown(w.value)} at ${w.t} ms${within ? ` (within ${within} ms)` : ''}`
    const hit = writes.findIndex(
      (x, i) =>
        !used.has(i) &&
        x.path === w.path &&
        same(x.value, w.value) &&
        x.ts >= w.t &&
        x.ts <= w.t + within
    )
    if (hit >= 0) {
      used.add(hit)
      continue
    }
    const near = writes
      .filter((x) => x.path === w.path)
      .sort((a, b) => Math.abs(a.ts - w.t) - Math.abs(b.ts - w.t))[0]
    if (near && same(near.value, w.value)) {
      out.push({
        expected,
        why: `written at ${near.ts} ms instead (run ${near.run})`,
        blockId: near.blockId,
        run: near.run,
      })
      continue
    }
    const setter = settersOf(graph, w.path, w.value)[0]
    if (!setter) {
      out.push({ expected, why: `no block writes ${w.path}` })
      continue
    }
    const way = wayTo(graph, setter.id)
    if (!way) {
      out.push({
        expected,
        why: `${name(setter.id)} is not connected to a trigger`,
        blockId: setter.id,
      })
      continue
    }
    const byTrigger = runs.filter((r) => r.trigger.blockId === way.trigger)
    const run = byTrigger
      .filter((r) => r.startedAt <= w.t + within)
      .sort((a, b) => b.startedAt - a.startedAt)[0]
    if (!run) {
      out.push({
        expected,
        why: `${name(way.trigger)} did not fire before ${w.t + within} ms`,
        blockId: way.trigger,
      })
      continue
    }
    const wrote = run.steps
      .find((s) => s.blockId === setter.id)
      ?.writes.find((x) => x.path === w.path)
    if (wrote) {
      out.push({
        expected,
        why: `run ${run.run} wrote ${shown(wrote.value)} at ${wrote.ts} ms`,
        blockId: setter.id,
        run: run.run,
      })
      continue
    }
    out.push({ expected, ...deviation(run, way.decisions, name) })
  }

  for (const n of scenario.expect?.never ?? []) {
    const from = n.from ?? 0
    const to = n.to ?? scenario.until
    const bad = writes.find((x) => x.path === n.path && x.ts >= from && x.ts <= to)
    if (!bad) continue
    const run = runs.find((r) => r.run === bad.run)
    const decided = run?.steps.filter((s) => s.handle && s.eval) ?? []
    const because = decided.length
      ? `: ${decided.map((s) => `${name(s.blockId)} → ${s.handle} (${evalText(s.eval!)})`).join(', ')}`
      : ''
    out.push({
      expected: `never ${n.path} between ${from} and ${to} ms`,
      why: `${name(bad.blockId)} wrote ${shown(bad.value)} at ${bad.ts} ms in run ${bad.run}${because}`,
      blockId: bad.blockId,
      run: bad.run,
    })
  }
  return out
}
