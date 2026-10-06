/**
 * M8 acceptance gate (analysis/phases/M08 "Gate", ADR-0027 Verification), run by `m8-gate.sh` in a
 * container on the dev stack's sv-internal network: real orchestrator, toolchain, databroker, gateway.
 *
 * GW-A live: SynCode ⇒ Run ⇒ app.started; inject Speed 100 then 130 and hold 3 s through the
 * signal-gateway ⇒ Hazard.IsSignaling switches; the run's trace has n2 (Stable for, b2) then n3 (Set
 * Hazard, b3) and its log; the event stream resumes after Last-Event-ID; Stop is clean in < 5 s.
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const slug = process.env.SLUG ?? "";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const golden = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A";
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => {
  const res = await fetch(url, { headers: h });
  if (!res.ok) throw new Error(`${url} ⇒ ${res.status} ${await res.text()}`);
  return res.json();
};
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
const sse = (text: string) =>
  text
    .split("\n\n")
    .map((b) => ({ id: /^id: (\d+)$/m.exec(b)?.[1], event: /^event: (.+)$/m.exec(b)?.[1], data: /^data: (.+)$/m.exec(b)?.[1] }))
    .filter((e) => e.data)
    .map((e) => ({ id: Number(e.id), event: e.event, data: JSON.parse(e.data!) }));

// 1. project + SynCode GW-A
const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
const scenario = Bun.YAML.parse(readFileSync(`${golden}/scenario.yaml`, "utf8"));
let p = await (await post(`${O}/projects`, { slug, name: "Gate M8", language: "cpp", vssRelease: "v4.0" })).json();
while (p.status === "creating") {
  await Bun.sleep(2000);
  p = await get(`${O}/projects/${p.id}`);
}
must(p.status === "ready", `project ${slug} ready`);
const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph], scenarios: [{ workflowId: graph.workflowId, scenario }] })).json();
await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
must(gen.success && Object.values(gen.verification).every((v) => v === "passed"), `SynCode GW-A ${gen.id}: ${JSON.stringify(gen.verification)}`);

// 2. run ⇒ running (app.started)
const t0 = Date.now();
const started = await post(`${O}/projects/${p.id}/runs`, { generationId: gen.id });
must(started.status === 202, `run requested (${started.status})`);
const run = await started.json();
let r = run;
while (r.state === "starting") {
  await Bun.sleep(200);
  r = await get(`${O}/runs/${run.id}`);
}
must(r.state === "running", `run ${run.id} running ${((Date.now() - t0) / 1000).toFixed(1)} s after Run (app.started < 30 s)`);
const busy = await post(`${O}/projects/${p.id}/runs`, { generationId: gen.id });
must(busy.status === 409, "a second run is refused while one is active (one shared runtime stack)");

// 3. inject through the gateway; watch Hazard on the gateway stream
const ctl = new AbortController();
const updates: { path: string; field: string; value: unknown; ts: number }[] = [];
const stream = await fetch(`${G}/signals?release=v4.0&paths=Vehicle.Speed,${HAZARD}`, { headers: h, signal: ctl.signal });
(async () => {
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const c of stream.body!) {
      buf += dec.decode(c);
      let i = buf.indexOf("\n\n");
      while (i >= 0) {
        const d = /^data: (.+)$/m.exec(buf.slice(0, i))?.[1];
        if (d) updates.push(JSON.parse(d));
        buf = buf.slice(i + 2);
        i = buf.indexOf("\n\n");
      }
    }
  } catch {}
})();
const set = (path: string, value: unknown, field = "value") => post(`${G}/signals`, { release: "v4.0", path, value, field });
must((await set(HAZARD, false, "target")).ok && (await set(HAZARD, false)).ok, "Hazard reset to false");
must((await set("Vehicle.Speed", 100)).ok, "inject Speed 100");
await Bun.sleep(500);
const injectedAt = Date.now();
must((await set("Vehicle.Speed", 130)).ok, "inject Speed 130, held 3 s");
await Bun.sleep(3000);
const on = updates.find((u) => u.path === HAZARD && u.field === "target" && u.value === true && u.ts >= injectedAt - 50);
must(on, `Hazard.IsSignaling target became true ${on ? `${on.ts - injectedAt} ms after Speed 130 (Stable for 2 s)` : ""}`);
must(updates.some((u) => u.path === HAZARD && u.field === "value" && u.value === true), "Hazard current value follows the target (gateway mirror)");
ctl.abort();

// 4. the run's events: trace n2 → n3 on blocks b2/b3, logs; resume after Last-Event-ID (the run is
// still active, so the stream stays open: read it for a moment)
const backlog = sse(await readFor(`${O}/events?runId=${run.id}`, 1500));
const traces = backlog.filter((e) => e.event === "trace").map((e) => e.data);
must(traces.some((t) => t.ev === "app.started"), "trace has app.started");
const n2 = traces.findIndex((t) => t.node === "n2" && t.blockId === "b2" && t.ev === "enter");
const n3 = traces.findIndex((t, k) => k > n2 && t.node === "n3" && t.blockId === "b3");
must(n2 >= 0 && n3 > n2, `trace n2 (Stable for, b2) then n3 (Set Hazard, b3): ${JSON.stringify(traces[n3] ?? null)}`);
must(backlog.some((e) => e.event === "log"), `run log streamed (${backlog.filter((e) => e.event === "log").length} lines)`);
must(backlog.every((e, k) => k === 0 || e.id === backlog[k - 1]!.id + 1), `${backlog.length} events, seq contiguous`);
const mid = backlog[Math.floor(backlog.length / 2)]!.id;
const resumed = sse(await readFor(`${O}/events?runId=${run.id}`, 1000, { "last-event-id": String(mid) }));
must(resumed[0]?.id === mid + 1 && resumed.length === backlog.at(-1)!.id - mid, `stream resumes after Last-Event-ID ${mid} at ${resumed[0]?.id} with the ${resumed.length} later events (a reload loses nothing)`);

// 5. stop < 5 s
const stopAt = Date.now();
must((await post(`${O}/runs/${run.id}/stop`, {})).ok, "stop requested");
while ((r = await get(`${O}/runs/${run.id}`)).state === "stopping" || r.state === "running") await Bun.sleep(100);
const stopMs = Date.now() - stopAt;
must(r.state === "stopped" && stopMs < 5000, `run ${r.state} in ${stopMs} ms (< 5 s), exit ${r.exitCode ?? "-"}`);
const tail = sse(await readFor(`${O}/events?runId=${run.id}`, 3000, { "last-event-id": String(mid) }));
must(tail.some((e) => e.event === "trace" && e.data.ev === "app.stopping"), "trace has app.stopping (clean shutdown)");

async function readFor(url: string, ms: number, extra: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { ...h, ...extra }, signal: AbortSignal.timeout(ms) });
  let text = "";
  const dec = new TextDecoder();
  try {
    for await (const c of res.body!) text += dec.decode(c);
  } catch {}
  return text;
}
