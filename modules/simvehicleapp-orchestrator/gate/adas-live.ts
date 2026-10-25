/**
 * ADAS live check, run by `adas-live.sh` on sv-internal: a conformance ADAS workflow is SynCoded with its scenario as
 * the test case (built and passed in the real toolchain), the app runs on the stack, the scenario is played on the
 * databroker with `observe` (ADR-0058 §4) and every expected write must be observed within 300 ms of its time.
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const slug = process.env.SLUG ?? "";
const language = process.env.LANG_ID ?? "cpp";
// `wasm`: the app is a WebAssembly guest of sv-wasm-host (ADR-0061, M20).
const target = process.env.TARGET === "wasm" ? "wasm" : undefined;
const dir = `/repo/modules/simvehicleapp-contracts/fixtures/conformance/${process.env.CASE ?? "C43-adas-forward-collision"}`;
const WITHIN_MS = 300;

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });

type Write = { t: number; path: string; value: unknown };
const graph = JSON.parse(readFileSync(`${dir}/graph.json`, "utf8"));
const scenario = Bun.YAML.parse(readFileSync(`${dir}/scenario.yaml`, "utf8")) as { until: number; expect: { writes: Write[] } };
const release = (graph.vssRelease as string | undefined) ?? "v4.0";
const expected = scenario.expect.writes;
const paths = [...new Set(expected.map((w) => w.path))];

let p = await (await post(`${O}/projects`, { slug: `${slug}-${language}`, name: `Gate ADAS ${language}`, language, ...(target ? { target } : {}), vssRelease: release })).json();
const t0 = Date.now();
while (p.status === "creating" && Date.now() - t0 < 600_000) {
  await Bun.sleep(2000);
  p = await get(`${O}/projects/${p.id}`);
}
must(p.status === "ready", `${language}: app ${p.slug} ready`);
const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph], scenarios: [{ workflowId: graph.workflowId, scenario }] })).json();
await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
must(gen.success && gen.verification?.tests === "passed", `${language}: SynCode ${graph.workflowId}, generated test passed ${JSON.stringify(gen.verification)}`);

const run = await (await post(`${O}/projects/${p.id}/runs`, {})).json();
let r = run;
for (let i = 0; i < 300 && r.state === "starting"; i++) {
  await Bun.sleep(100);
  r = await get(`${O}/runs/${run.id}`);
}
if (r.state !== "running") {
  console.log(`  diagnostics: ${JSON.stringify(r.diagnostics ?? [])}`);
  // Why it did not start: the run's log (the stream ends once the run has stopped).
  const res = await fetch(`${O}/events?runId=${run.id}`, { headers: h, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const text = res ? await res.text().catch(() => "") : "";
  for (const line of text.split("\n").filter((l) => l.startsWith("data: ")).slice(-40)) console.log(`  ${line.slice(6, 300)}`);
}
must(r.state === "running", `${language}: app running (${r.state})`);
const sandbox = r.sandbox as string | undefined;
const pb0 = await (await post(`${G}/play`, { release, ...(sandbox ? { sandbox } : {}), scenario, observe: paths })).json();
must(pb0.state === "playing", `playing ${paths.length} observed path(s)`);
await Bun.sleep(scenario.until + 1500);
const pb = await get(`${G}/play${sandbox ? `?sandbox=${sandbox}` : ""}`);
const observed = (pb.observed ?? []) as Write[];
console.log(`observed: ${observed.map((o) => `${o.t} ${o.path.split(".").slice(-2).join(".")}=${JSON.stringify(o.value)}`).join(", ")}`);
const missing = expected.filter((w) => !observed.some((o) => o.path === w.path && JSON.stringify(o.value) === JSON.stringify(w.value) && o.t >= w.t && o.t - w.t <= WITHIN_MS));
await post(`${O}/runs/${run.id}/stop`, {});
if (missing.length) {
  // What the app did: its trace and log of this run (the stream ends once the run has stopped).
  const res = await fetch(`${O}/events?runId=${run.id}`, { headers: h, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  const text = res ? await res.text().catch(() => "") : "";
  for (const line of text.split("\n").filter((l) => l.startsWith("data: ")).slice(-80)) console.log(`  ${line.slice(6, 260)}`);
}
for (const w of expected) {
  const o = observed.find((x) => x.path === w.path && JSON.stringify(x.value) === JSON.stringify(w.value) && x.t >= w.t && x.t - w.t <= WITHIN_MS);
  must(o, `write ${w.path} = ${JSON.stringify(w.value)} at ${w.t} ms observed${o ? ` at ${o.t} ms` : ""}`);
}
