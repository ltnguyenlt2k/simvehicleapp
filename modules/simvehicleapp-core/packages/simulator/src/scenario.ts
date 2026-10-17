import type { SimulationResult, TraceEvent } from "./simulator.ts";

/**
 * Scenario v1 expectations (contracts `scenario`, ADR-0017 §3): `expect.writes` is the exact,
 * ordered list of actuator writes; `expect.trace` entries are partial TraceEvent matchers that must
 * appear in that order (fields compared when present, `data` compared recursively as a subset);
 * `expect.publishes` is the exact, ordered list of MQTT publishes (time, topic, payload text).
 */
export interface ScenarioExpect {
  writes?: { t: number; path: string; value: unknown; within?: number }[];
  publishes?: { t: number; topic: string; payload: string; within?: number }[];
  trace?: Record<string, unknown>[];
  /** Scenario 1.1: `path` must not be written in `[from, to]` (`to` absent: until the end). */
  never?: { path: string; from?: number; to?: number }[];
}

export interface ExpectMismatch {
  kind: "writes" | "publishes" | "trace" | "never";
  message: string;
}

/**
 * Scenario 1.1 (ADR-0058 §9, design M18 §9.3): expectations are a subset — each expected write/publish matches a
 * distinct actual one, in order, at `t ≤ actual.t ≤ t + within` (`within` 0 by default); more writes do not fail
 * unless `never` forbids them. 1.0 keeps the exact ordered lists (conformance C01–C45 unchanged).
 */
export function isScenario11(version: string | undefined): boolean {
  const m = /^1\.(\d+)\./.exec(version ?? "");
  return Boolean(m && Number(m[1]) >= 1);
}

function matchInOrder<T extends { t: number }>(want: (T & { within?: number })[], have: T[], key: (x: T) => string): { missing: (T & { within?: number })[]; drifts: number[] } {
  const used = new Set<number>();
  const missing: (T & { within?: number })[] = [];
  const drifts: number[] = [];
  let from = 0;
  for (const w of want) {
    const k = key(w);
    const i = have.findIndex((h, j) => j >= from && !used.has(j) && key(h) === k && h.t >= w.t && h.t <= w.t + (w.within ?? 0));
    if (i < 0) missing.push(w);
    else {
      used.add(i);
      drifts.push(have[i]!.t - w.t);
      from = i + 1;
    }
  }
  return { missing, drifts };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function subset(want: unknown, have: unknown): boolean {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!have || typeof have !== "object") return false;
    return Object.entries(want).every(([k, v]) => subset(v, (have as Record<string, unknown>)[k]));
  }
  return same(want, have);
}

export function checkExpectations(result: SimulationResult, expect: ScenarioExpect | undefined, scenarioVersion?: string): ExpectMismatch[] {
  const out: ExpectMismatch[] = [];
  if (!expect) return out;
  if (isScenario11(scenarioVersion)) return checkExpectations11(result, expect, out);
  if (expect.writes) {
    const have = result.writes.map((w) => ({ t: w.t, path: w.path, value: w.value }));
    if (!same(have, expect.writes)) {
      out.push({ kind: "writes", message: `writes differ:\n  expected ${JSON.stringify(expect.writes)}\n  actual   ${JSON.stringify(have)}` });
    }
  }
  if (expect.publishes) {
    // Exact text: the HMI/MQTT payload a vehicle app sends must be the same in every backend (number formatting included).
    const have = result.publishes.map((p) => ({ t: p.t, topic: p.topic, payload: p.payload }));
    if (!same(have, expect.publishes)) {
      out.push({ kind: "publishes", message: `publishes differ:\n  expected ${JSON.stringify(expect.publishes)}\n  actual   ${JSON.stringify(have)}` });
    }
  }
  if (expect.trace) {
    let i = 0;
    for (const m of expect.trace) {
      while (i < result.trace.length && !subset(m, result.trace[i] as TraceEvent)) i++;
      if (i === result.trace.length) {
        out.push({ kind: "trace", message: `trace event ${JSON.stringify(m)} not found (in order)` });
        break;
      }
      i++;
    }
  }
  return out;
}

function checkExpectations11(result: SimulationResult, expect: ScenarioExpect, out: ExpectMismatch[]): ExpectMismatch[] {
  const writes = result.writes.map((w) => ({ t: w.t, path: w.path, value: w.value }));
  if (expect.writes) {
    const { missing } = matchInOrder(expect.writes, writes, (w) => `${w.path}=${JSON.stringify(w.value)}`);
    for (const m of missing) out.push({ kind: "writes", message: `expected ${m.path} = ${JSON.stringify(m.value)} at ${m.t} ms${m.within ? ` (within ${m.within} ms)` : ""}; actual writes ${JSON.stringify(writes)}` });
  }
  if (expect.publishes) {
    const pubs = result.publishes.map((p) => ({ t: p.t, topic: p.topic, payload: p.payload }));
    const { missing } = matchInOrder(expect.publishes, pubs, (p) => `${p.topic}\u0000${p.payload}`);
    for (const m of missing) out.push({ kind: "publishes", message: `expected a publish on ${m.topic} (${m.payload}) at ${m.t} ms${m.within ? ` (within ${m.within} ms)` : ""}; actual ${JSON.stringify(pubs)}` });
  }
  for (const n of expect.never ?? []) {
    const hit = writes.find((w) => w.path === n.path && w.t >= (n.from ?? 0) && (n.to === undefined || w.t <= n.to));
    if (hit) out.push({ kind: "never", message: `${n.path} must not be written${n.from !== undefined || n.to !== undefined ? ` in [${n.from ?? 0}, ${n.to ?? "end"}] ms` : ""}: written ${JSON.stringify(hit.value)} at ${hit.t} ms` });
  }
  if (expect.trace) checkTrace(result, expect.trace, out);
  return out;
}

function checkTrace(result: SimulationResult, trace: Record<string, unknown>[], out: ExpectMismatch[]) {
  let i = 0;
  for (const m of trace) {
    while (i < result.trace.length && !subset(m, result.trace[i] as TraceEvent)) i++;
    if (i === result.trace.length) {
      out.push({ kind: "trace", message: `trace event ${JSON.stringify(m)} not found (in order)` });
      break;
    }
    i++;
  }
}
