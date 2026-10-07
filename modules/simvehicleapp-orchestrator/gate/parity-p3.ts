/**
 * Parity P3 (ADR-0042, M11-T01): every golden workflow GW-A…G as a real app on the real stack —
 * SynCode builds it, Run starts the binary against the KUKSA databroker, the signal-gateway plays
 * its scenario — and the run's trace must match the frozen `expected.trace.json` (the simulator's,
 * reviewed): same events in the same order (ev, node, block, run, data without timestamps), each
 * within the 10 ms grid ± 20 ms timer tolerance (see `drifts`). Run by `parity-p3.sh` on the dev
 * stack's sv-internal network; writes a JSON report.
 *
 * The scenario's `initial` values are set before the app starts (they are the state the app finds,
 * not inputs); the inputs are then played in real time.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const slug = process.env.SLUG ?? `parity-p3-${Date.now()}`;
const only = (process.env.GOLDENS ?? "").split(",").filter(Boolean);
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const ROOT = "/repo/modules/simvehicleapp-contracts/fixtures/golden";
/** ADR-0042 §1: 10 ms grid, ± 20 ms timer tolerance. */
export const TOLERANCE_MS = 10 + 20;

export interface TraceEvent {
  ts: number;
  ev: string;
  wf?: string;
  run?: number;
  node?: string;
  blockId?: string;
  data?: Record<string, unknown>;
}

const get = async (url: string) => {
  const res = await fetch(url, { headers: h });
  if (!res.ok) throw new Error(`${url} ⇒ ${res.status} ${await res.text()}`);
  return res.json();
};
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });

/** Data compared without time stamps (virtual ms in the expectation, wall clock on the stack). */
function untimed(v: unknown): unknown {
  // MQTT payloads are JSON strings carrying a `ts` of their own.
  if (typeof v === "string" && v.startsWith("{")) {
    try {
      return untimed(JSON.parse(v));
    } catch {
      return v;
    }
  }
  if (Array.isArray(v)) return v.map(untimed);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== "timestamp" && k !== "ts")
        .map(([k, x]) => [k, untimed(x)]),
    );
  }
  return typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1e6) / 1e6 : v;
}

const key = (e: TraceEvent) => JSON.stringify([e.ev, e.wf, e.run, e.node, e.blockId, untimed(e.data ?? {})]);

/**
 * Drift of each paired event (actual − expected, ms). Triggers are measured from the time origin (the
 * median trigger offset: the scenario player's jitter is within the tolerance); every other event is
 * measured as the app's reaction time since the latest trigger before it, so timers and stable_for
 * windows are checked against ADR-0042's ± 20 ms. Before any trigger (app start, periodic timers) the
 * origin is the median offset of all events.
 */
export function drifts(expected: TraceEvent[], actual: TraceEvent[], play?: { startedAt: number; inputs: number[] }): number[] {
  const n = Math.min(expected.length, actual.length);
  const median = (xs: number[]) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]! : 0);
  const triggers = [...Array(n).keys()].filter((i) => expected[i]!.ev === "trigger");
  const origin = median((triggers.length ? triggers : [...Array(n).keys()]).map((i) => actual[i]!.ts - expected[i]!.ts));
  const out: number[] = [];
  let last = -1;
  for (let i = 0; i < n; i++) {
    const e = expected[i]!;
    const a = actual[i]!;
    if (e.ev === "trigger") last = i;
    // An event after the latest trigger that a later scenario input caused (a wait resumed by it) reacts to
    // that input: measured from when the gateway played it, not from the trigger (a slow trigger reaction
    // would make it look early).
    const input = play && last >= 0 ? Math.max(-Infinity, ...play.inputs.filter((t) => t > expected[last]!.ts && t <= e.ts)) : -Infinity;
    if (e.ev !== "trigger" && Number.isFinite(input)) out.push(a.ts - (play!.startedAt + input) - (e.ts - input));
    else out.push(e.ev === "trigger" || last < 0 ? a.ts - origin - e.ts : a.ts - actual[last]!.ts - (e.ts - expected[last]!.ts));
  }
  return out;
}

/** Differences between the expected trace and the actual one (empty ⇒ parity). */
export function compareTraces(expected: TraceEvent[], actual: TraceEvent[], play?: { startedAt: number; inputs: number[] }): string[] {
  const problems: string[] = [];
  const n = Math.max(expected.length, actual.length);
  const drift = drifts(expected, actual, play);
  for (let i = 0; i < n; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e) {
      problems.push(`#${i} unexpected ${key(a!)}`);
      continue;
    }
    if (!a) {
      problems.push(`#${i} missing ${key(e)} at ${e.ts}`);
      continue;
    }
    if (key(e) !== key(a)) {
      problems.push(`#${i} expected ${key(e)} at ${e.ts}, got ${key(a)}`);
      break; // later events only repeat the shift
    }
    if (Math.abs(drift[i]!) > TOLERANCE_MS) problems.push(`#${i} ${e.ev} ${e.node ?? ""} (expected at ${e.ts}): drift ${drift[i]} ms > ${TOLERANCE_MS}`);
  }
  return problems;
}

async function readEvents(url: string, until: () => boolean): Promise<{ event: string; data: TraceEvent }[]> {
  const ctl = new AbortController();
  const res = await fetch(url, { headers: h, signal: ctl.signal });
  const out: { event: string; data: TraceEvent }[] = [];
  const dec = new TextDecoder();
  let buf = "";
  const timer = setInterval(() => until() && ctl.abort(), 100);
  try {
    for await (const c of res.body!) {
      buf += dec.decode(c, { stream: true });
      let i = buf.indexOf("\n\n");
      while (i >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) out.push({ event, data: JSON.parse(data) });
        i = buf.indexOf("\n\n");
      }
    }
  } catch {
    /* aborted once the run ended */
  } finally {
    clearInterval(timer);
  }
  return out;
}

/** One Run of a golden's generation with its scenario played; the run's trace events of the workflow. */
async function playOnce(projectId: string, generationId: string, g: string, workflowId: string, scenario: { initial?: Record<string, unknown>; inputs: { t: number }[]; until: number; [k: string]: unknown }): Promise<{ trace: TraceEvent[]; play: { startedAt: number; inputs: number[] } }> {
  // The state the app finds: initial values, set before it starts.
  const { initial = {}, ...rest } = scenario;
  if (Object.keys(initial).length) {
    const set = await post(`${G}/play`, { release: "v4.0", scenario: { ...rest, name: `${g} initial`, initial, inputs: [], until: 0 } });
    if (!set.ok) throw new Error(`initial of ${g}: ${set.status} ${await set.text()}`);
    // Actuator targets too: a target left by an earlier run would be mirrored onto the current value
    // when the run starts. Sensors refuse a target: ignored.
    for (const [path, value] of Object.entries(initial)) await post(`${G}/signals`, { release: "v4.0", path, value, field: "target" });
    await Bun.sleep(500);
  }
  const run = await (await post(`${O}/projects/${projectId}/runs`, { generationId })).json();
  let r = run;
  while (r.state === "starting") {
    await Bun.sleep(100);
    r = await get(`${O}/runs/${run.id}`);
  }
  if (r.state !== "running") throw new Error(`${g}: run ${r.state} ${JSON.stringify(r.diagnostics ?? [])}`);
  // The expectation has no vehicle provider: an actuator's current value changes only when the scenario
  // sets it. Dev runs mirror the app's targets to current values (the provider role, ADR-0024): off here.
  const mirror = await fetch(`${G}/mirror`, { method: "PUT", headers: h, body: JSON.stringify({ release: "v4.0", paths: [] }) });
  if (!mirror.ok) throw new Error(`${g}: mirror off ${mirror.status}`);
  let done = false;
  const events = readEvents(`${O}/events?runId=${run.id}`, () => done);
  const play = await post(`${G}/play`, { release: "v4.0", scenario: { ...rest, inputs: scenario.inputs } });
  if (!play.ok) throw new Error(`play ${g}: ${play.status} ${await play.text()}`);
  const { startedAt } = (await play.json()) as { startedAt: number };
  await Bun.sleep(scenario.until + 1500);
  await post(`${O}/runs/${run.id}/stop`, {});
  while (["running", "stopping"].includes((r = await get(`${O}/runs/${run.id}`)).state)) await Bun.sleep(200);
  await Bun.sleep(500);
  done = true;
  const trace = (await events).filter((e) => e.event === "trace" && e.data.wf === workflowId).map((e) => e.data);
  return { trace, play: { startedAt, inputs: scenario.inputs.map((i) => i.t) } };
}

/** The run lasts a little longer than the scenario: events after its `until` are not part of it. */
export function withinScenario(expected: TraceEvent[], actual: TraceEvent[], until: number): TraceEvent[] {
  const e0 = expected.find((e) => e.ev === "trigger");
  const a0 = actual.find((e) => e.ev === "trigger");
  if (!e0 || !a0) return actual;
  const end = a0.ts - e0.ts + until + TOLERANCE_MS;
  return actual.filter((e) => e.ts <= end);
}

async function main() {
  const goldens = readdirSync(ROOT).filter((d) => /^GW-[A-Z]$/.test(d) && (!only.length || only.includes(d))).sort();
  let p = await (await post(`${O}/projects`, { slug, name: "Parity P3", language: process.env.SV_PARITY_LANGUAGE ?? "cpp", vssRelease: "v4.0", settings: { traceLevel: "node" } })).json();
  while (p.status === "creating") {
    await Bun.sleep(2000);
    p = await get(`${O}/projects/${p.id}`);
  }
  if (p.status !== "ready") throw new Error(`project ${slug}: ${p.status}`);
  const report: { golden: string; pass: boolean; expected: number; actual: number; problems: string[]; maxDriftMs: number; buildMs: number; drifts?: string[]; clockSteps?: number[] }[] = [];

  for (const g of goldens) {
    const graph = JSON.parse(readFileSync(`${ROOT}/${g}/graph.json`, "utf8"));
    const scenario = Bun.YAML.parse(readFileSync(`${ROOT}/${g}/scenario.yaml`, "utf8")) as { initial?: Record<string, unknown>; inputs: { t: number }[]; until: number; [k: string]: unknown };
    const expected = (JSON.parse(readFileSync(`${ROOT}/${g}/expected.trace.json`, "utf8")) as TraceEvent[]).filter((e) => e.wf === graph.workflowId);
    const t0 = Date.now();
    const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph], scenarios: [{ workflowId: graph.workflowId, scenario }] })).json();
    await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
    const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
    const buildMs = Date.now() - t0;
    if (!gen.success) {
      report.push({ golden: g, pass: false, expected: expected.length, actual: 0, problems: [`SynCode failed: ${JSON.stringify(gen.diagnostics?.slice(0, 2))}`], maxDriftMs: 0, buildMs });
      console.log(`FAIL ${g}: SynCode failed`);
      continue;
    }
    // The run's trace carries wall-clock times; a wall-clock step during the run (NTP, WSL time sync)
    // shifts them, so a golden whose run saw a step is played again (at most twice), and the report says so.
    let actual: TraceEvent[] = [];
    let play: { startedAt: number; inputs: number[] } | undefined;
    const steps: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const skew0 = Date.now() - performance.now();
      const once = await playOnce(p.id, gen.id, g, graph.workflowId, scenario);
      play = once.play;
      actual = withinScenario(expected, once.trace, scenario.until);
      const step = Math.round(Date.now() - performance.now() - skew0);
      if (Math.abs(step) <= 15) break;
      steps.push(step);
      console.log(`  ${g}: wall clock stepped ${step} ms during the run — playing it again`);
    }
    const problems = compareTraces(expected, actual, play);
    if (process.env.SV_PARITY_DEBUG) for (const e of actual.filter((x) => x.ev === "trigger")) console.log(`  trigger ts=${e.ts} data=${JSON.stringify(e.data)}`);
    const drift = drifts(expected, actual, play);
    const maxDriftMs = Math.max(0, ...drift.map(Math.abs));
    report.push({ golden: g, pass: problems.length === 0, expected: expected.length, actual: actual.length, problems, maxDriftMs, buildMs, ...(steps.length ? { clockSteps: steps } : {}), drifts: drift.map((d, i) => `${expected[i]!.ts} ${expected[i]!.ev} ${expected[i]!.node ?? ""}: ${d} ms (actual ts ${actual[i]!.ts})`) });
    console.log(`${problems.length ? "FAIL" : "ok  "} ${g}: ${actual.length}/${expected.length} events, max drift ${maxDriftMs} ms, SynCode ${(buildMs / 1000).toFixed(0)} s${problems.length ? `\n  ${problems.slice(0, 6).join("\n  ")}` : ""}`);
  }
  const passed = report.filter((x) => x.pass).length;
  console.log(`\nParity P3: ${passed}/${report.length} goldens (${Math.round((100 * passed) / Math.max(1, report.length))} %) — project ${slug}`);
  if (process.env.SV_PARITY_REPORT) writeFileSync(process.env.SV_PARITY_REPORT, JSON.stringify({ slug, date: new Date().toISOString(), passed, total: report.length, toleranceMs: TOLERANCE_MS, goldens: report }, null, 2));
  process.exit(passed === report.length ? 0 : 1);
}

if (import.meta.main) await main();
