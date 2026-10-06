import type { SimulationResult, TraceEvent } from "./simulator.ts";

/**
 * Scenario v1 expectations (contracts `scenario`, ADR-0017 §3): `expect.writes` is the exact,
 * ordered list of actuator writes; `expect.trace` entries are partial TraceEvent matchers that must
 * appear in that order (fields compared when present, `data` compared recursively as a subset).
 */
export interface ScenarioExpect {
  writes?: { t: number; path: string; value: unknown }[];
  trace?: Record<string, unknown>[];
}

export interface ExpectMismatch {
  kind: "writes" | "trace";
  message: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function subset(want: unknown, have: unknown): boolean {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!have || typeof have !== "object") return false;
    return Object.entries(want).every(([k, v]) => subset(v, (have as Record<string, unknown>)[k]));
  }
  return same(want, have);
}

export function checkExpectations(result: SimulationResult, expect: ScenarioExpect | undefined): ExpectMismatch[] {
  const out: ExpectMismatch[] = [];
  if (!expect) return out;
  if (expect.writes) {
    const have = result.writes.map((w) => ({ t: w.t, path: w.path, value: w.value }));
    if (!same(have, expect.writes)) {
      out.push({ kind: "writes", message: `writes differ:\n  expected ${JSON.stringify(expect.writes)}\n  actual   ${JSON.stringify(have)}` });
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
