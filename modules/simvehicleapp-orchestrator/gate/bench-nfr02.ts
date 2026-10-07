/**
 * NFR-02 benchmark (analysis/01 §NFR-02, M11-T07) on the running stack: validate (compiler `verify`)
 * of a 200-block workflow < 300 ms; simulate start (compile + simulate GW-A) < 1 s; SynCode of a new
 * project (first build, caches baked in the image) < 10 min; incremental SynCode (warm cache, one prop
 * changed) < 60 s. p50/p95 over repeated runs; writes a JSON report. Run by `bench-nfr02.sh`.
 */
import { readFileSync, writeFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const C = process.env.SV_COMPILER_URL ?? "http://compiler:4020";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const GOLDEN = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A";
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;

/** A valid 200-block workflow: one trigger, then a chain of 199 logs reading the trigger's value. */
export function bigGraph(n = 200) {
  const blocks = [{ id: "b0", type: "sv_on_signal_changed", name: "Speed changed", props: { path: "Vehicle.Speed", mode: "any" }, parentId: null, blockVersion: 1 }];
  const edges = [];
  for (let i = 1; i < n; i++) {
    blocks.push({ id: `b${i}`, type: "sv_log", name: `Log ${i}`, props: { level: "info", message: `step ${i}: <speedchanged.value>` } as never, parentId: null, blockVersion: 1 });
    edges.push({ id: `e${i}`, from: `b${i - 1}`, fromHandle: "source", to: `b${i}`, toHandle: "target" });
  }
  return { graphVersion: "1.0.0", workflowId: "bench_200", revision: 0, name: "Bench 200", vss: { release: "v4.0" }, variables: [], blocks, edges };
}

async function timed<T>(f: () => Promise<T>): Promise<[number, T]> {
  const t0 = performance.now();
  const v = await f();
  return [Math.round(performance.now() - t0), v];
}

async function syncode(projectId: string, graph: unknown, scenario: unknown): Promise<number> {
  const [ms, gen] = await timed(async () => {
    const q = await (await post(`${O}/projects/${projectId}/generations`, { graphs: [graph], scenarios: [{ workflowId: (graph as { workflowId: string }).workflowId, scenario }] })).json();
    await (await fetch(`${O}/events?generationId=${q.id}`, { headers: h })).text();
    return get(`${O}/projects/${projectId}/generations/${q.id}`);
  });
  if (!gen.success) throw new Error(`SynCode failed: ${JSON.stringify(gen.diagnostics?.slice(0, 2))}`);
  return ms;
}

async function main() {
  const rows: { metric: string; target: string; p50: number; p95: number; n: number; pass: boolean }[] = [];
  const add = (metric: string, targetMs: number, xs: number[]) => {
    const row = { metric, target: `< ${targetMs} ms`, p50: pct(xs, 50), p95: pct(xs, 95), n: xs.length, pass: pct(xs, 95) < targetMs };
    rows.push(row);
    console.log(`${row.pass ? "ok  " : "FAIL"} ${metric}: p50 ${row.p50} ms, p95 ${row.p95} ms (n=${row.n}, target ${row.target})`);
  };

  // Validate: compiler verify of 200 blocks (the editor's lint + verify), warm service.
  const big = bigGraph();
  const first = await (await post(`${C}/compile`, { graph: big, mode: "verify" })).json();
  const errors = (first.diagnostics ?? []).filter((d: { severity: string }) => d.severity === "error");
  if (errors.length) throw new Error(`200-block graph is not valid: ${JSON.stringify(errors.slice(0, 2))}`);
  const validate: number[] = [];
  for (let i = 0; i < 30; i++) validate.push((await timed(() => post(`${C}/compile`, { graph: big, mode: "verify" }).then((r) => r.json())))[0]);
  add("validate 200 blocks (compiler verify)", 300, validate);

  // Simulate start: compile GW-A for the simulator, then simulate its scenario (the Simulate button).
  const graph = JSON.parse(readFileSync(`${GOLDEN}/graph.json`, "utf8"));
  const scenario = Bun.YAML.parse(readFileSync(`${GOLDEN}/scenario.yaml`, "utf8"));
  const simulate: number[] = [];
  for (let i = 0; i < 20; i++) {
    simulate.push(
      (
        await timed(async () => {
          const c = await (await post(`${C}/compile`, { graph, mode: "build" })).json();
          return (await post(`${C}/simulate`, { ir: c.ir, scenario })).json();
        })
      )[0],
    );
  }
  add("simulate GW-A (compile + simulate)", 1000, simulate);

  // SynCode: a new project's first generation, then warm repeats and one-prop changes.
  const slug = `bench-${Date.now()}`;
  let p = await (await post(`${O}/projects`, { slug, name: "Bench NFR-02", language: "cpp", vssRelease: "v4.0" })).json();
  while (p.status === "creating") {
    await Bun.sleep(2000);
    p = await get(`${O}/projects/${p.id}`);
  }
  add("SynCode first build of a new project", 600_000, [await syncode(p.id, graph, scenario)]);
  const warm: number[] = [];
  for (let i = 0; i < 3; i++) {
    const changed = structuredClone(graph);
    // A change the scenario's expectations do not see (its generated test still passes).
    changed.blocks.find((b: { type: string }) => b.type === "sv_hmi_notify").props.message = `Overspeed (${i + 1})`;
    warm.push(await syncode(p.id, changed, scenario));
  }
  add("SynCode incremental (warm, one prop changed)", 60_000, warm);

  const passed = rows.every((r) => r.pass);
  console.log(`\nNFR-02: ${passed ? "PASS" : "FAIL"} (project ${slug})`);
  if (process.env.SV_BENCH_REPORT) writeFileSync(process.env.SV_BENCH_REPORT, JSON.stringify({ date: new Date().toISOString(), slug, passed, rows }, null, 2));
  process.exit(passed ? 0 : 1);
}

if (import.meta.main) await main();
