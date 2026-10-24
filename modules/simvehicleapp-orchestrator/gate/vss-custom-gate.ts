/**
 * Custom VSS model gate (ADR-0052, ADR-0050 #10 Verification), run by `vss-custom-gate.sh` on the dev stack after
 * `scripts/sv vss add <release> --overlay docs/examples/vss/overlay-acme.json` and `scripts/sv vss use <release>`.
 *
 * Phase 1, per language (cpp, python, rust):
 *   - lint knows the vendor signals in the custom release only;
 *   - the simulator follows the workflow;
 *   - SynCode builds the app and passes its tests (vehicle model generated from the custom file);
 *   - Run on databroker-custom: an injected DrowsinessLevel drives the WarningLevel actuator.
 * Phase 2 (`PHASE=2`, after the model gained Vehicle.Acme.Hmi.Chime): the same projects SynCode a workflow on the
 * new signal. This proves the projects followed the changed model (workspace vss-sync + model regeneration).
 */
const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const C = process.env.SV_COMPILER_URL ?? "http://compiler:4020";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const RELEASE = process.env.RELEASE ?? "v4.0-acme";
const PHASE = process.env.PHASE ?? "1";
const STAMP = process.env.STAMP ?? String(Date.now());
const LANGS = (process.env.LANGS ?? "cpp python rust").split(/\s+/).filter(Boolean);
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const DROWSY = "Vehicle.Acme.DriverMonitor.DrowsinessLevel";
const LEVEL = "Vehicle.Acme.Hmi.WarningLevel";
const CHIME = "Vehicle.Acme.Hmi.Chime";

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
const block = (id: string, type: string, name: string, props: Record<string, unknown>) => ({ id, type, name, props, parentId: null, blockVersion: 1 });
const edge = (id: string, from: string, fromHandle: string, to: string) => ({ id, from, fromHandle, to, toHandle: "target" });

/** Drowsy (level ≥ 2) ⇒ warning level 2, otherwise 0. Phase 2 also rings the new Chime signal. */
const graph = (release: string, withChime: boolean) => ({
  graphVersion: "1.0.0",
  workflowId: withChime ? "acme_drowsy_chime" : "acme_drowsy",
  revision: 1,
  name: withChime ? "Drowsy driver chime" : "Drowsy driver warning",
  vss: { release },
  variables: [],
  blocks: [
    block("b1", "sv_on_signal_changed", "drowsy", { path: DROWSY, mode: "any", debounceMs: 0, concurrency: "restart" }),
    block("b2", "sv_if", "check", { condition: "<drowsy.value> >= 2" }),
    block("b3", "sv_set_actuator", "warn", { path: withChime ? CHIME : LEVEL, value: withChime ? true : 2, awaitAck: true, onError: "continue" }),
    block("b4", "sv_set_actuator", "clear", { path: withChime ? CHIME : LEVEL, value: withChime ? false : 0, awaitAck: true, onError: "continue" }),
  ],
  edges: [edge("e1", "b1", "source", "b2"), edge("e2", "b2", "then", "b3"), edge("e3", "b2", "else", "b4")],
});
const out = (withChime: boolean) => (withChime ? CHIME : LEVEL);
const on = (withChime: boolean) => (withChime ? true : 2);
const off = (withChime: boolean) => (withChime ? false : 0);
const scenario = (withChime: boolean) => ({
  scenarioVersion: "1.0.0",
  name: "drowsy",
  vss: { release: RELEASE },
  until: 3000,
  initial: { [DROWSY]: 0, [out(withChime)]: off(withChime) },
  inputs: [
    { t: 1000, path: DROWSY, value: 2 },
    { t: 2000, path: DROWSY, value: 1 },
  ],
  expect: { writes: [{ t: 1000, path: out(withChime), value: on(withChime) }, { t: 2000, path: out(withChime), value: off(withChime) }] },
});

// A gate that failed mid-run leaves its run active (one runtime stack ⇒ the next Run answers 409): stop it first.
for (const r of ((await get(`${O}/runs?active=true`)) as { runs: { id: string }[] }).runs) {
  await post(`${O}/runs/${r.id}/stop`, {});
  while (["stopping", "running"].includes(((await get(`${O}/runs/${r.id}`)) as { state: string }).state)) await Bun.sleep(200);
  console.log(`stopped a leftover run ${r.id}`);
}

const withChime = PHASE === "2";
const g = graph(RELEASE, withChime);

// 1. compiler: the vendor signals exist in the custom release only
const codes = async (gr: unknown) => ((await (await post(`${C}/lint`, { graph: gr })).json()) as { diagnostics: { code: string }[] }).diagnostics.map((d) => d.code);
must(!(await codes(g)).some((c) => c.startsWith("VEHICLE_PATH")), `lint on ${RELEASE}: ${out(withChime)} and ${DROWSY} resolve`);
must((await codes(graph("v4.0", withChime))).includes("VEHICLE_PATH_NOT_FOUND"), "lint on v4.0: the same signals are unknown (catalog per release)");

// 2. simulator
const built = (await (await post(`${C}/compile`, { graph: g, mode: "build" })).json()) as { ir?: unknown; diagnostics?: unknown };
must(built.ir, `compile ${g.workflowId} (${JSON.stringify(built.diagnostics ?? []).slice(0, 200)})`);
const sim = (await (await post(`${C}/simulate`, { ir: built.ir, scenario: scenario(withChime) })).json()) as { writes?: { t: number; path: string; value: unknown }[] };
const writes = (sim.writes ?? []).filter((w) => w.path === out(withChime)).map((w) => [w.t, w.value]);
must(JSON.stringify(writes) === JSON.stringify([[1000, on(withChime)], [2000, off(withChime)]]), `simulate: ${out(withChime)} ${JSON.stringify(writes)}`);

for (const lang of LANGS) {
  const slug = `vss-${lang}-${STAMP}`;
  // 3. project on the custom release (phase 2 reuses it) + SynCode
  let p: { id: string; status: string; vssRelease: string };
  if (PHASE === "1") {
    p = await (await post(`${O}/projects`, { slug, name: `Custom VSS ${lang}`, language: lang, vssRelease: RELEASE })).json();
    while (p.status === "creating") {
      await Bun.sleep(2000);
      p = await get(`${O}/projects/${p.id}`);
    }
  } else {
    p = ((await get(`${O}/projects`)) as { projects: (typeof p & { slug: string })[] }).projects.find((x) => x.slug === slug)!;
  }
  must(p?.status === "ready" && p.vssRelease === RELEASE, `[${lang}] project ${slug} ready on ${RELEASE}`);
  const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [g], scenarios: [{ workflowId: g.workflowId, scenario: scenario(withChime) }] })).json();
  const log = await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
  const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
  if (!gen.success) console.error(log.split("\n").filter((l) => l.startsWith("data:")).slice(-25).join("\n"));
  must(gen.success && Object.values(gen.verification).every((v) => v === "passed"), `[${lang}] SynCode ${g.workflowId}: ${JSON.stringify(gen.verification)}`);
  if (PHASE === "2") must(log.includes(`VSS ${RELEASE} changed in the catalog`), `[${lang}] the project's VSS file followed the changed model (vss-sync)`);

  // 4. live run on databroker-custom, inject through the signal-gateway
  const started = await post(`${O}/projects/${p.id}/runs`, { generationId: gen.id });
  must(started.status === 202, `[${lang}] run requested (${started.status})`);
  let r = await started.json();
  while (r.state === "starting") {
    await Bun.sleep(200);
    r = await get(`${O}/runs/${r.id}`);
  }
  must(r.state === "running", `[${lang}] run ${r.id} running on ${RELEASE}`);
  const set = (path: string, value: unknown, field = "value") => post(`${G}/signals`, { release: RELEASE, path, value, field });
  const target = async () => {
    const res = await fetch(`${G}/signals?release=${RELEASE}&paths=${out(withChime)}`, { headers: h, signal: AbortSignal.timeout(1500) });
    let text = "";
    try {
      for await (const c of res.body!) text += new TextDecoder().decode(c);
    } catch {}
    const ups = text.split("\n\n").map((b) => /^data: (.+)$/m.exec(b)?.[1]).filter(Boolean).map((d) => JSON.parse(d!));
    // The current value: a kuksa.val.v2 app (the default, ADR-0047) actuates and the gateway publishes it; a v1 app sets
    // the target, which the gateway mirrors.
    return ups.filter((u) => u.field === "value").at(-1)?.value;
  };
  must((await set(out(withChime), off(withChime), "target")).ok && (await set(out(withChime), off(withChime))).ok && (await set(DROWSY, 0)).ok, `[${lang}] ${out(withChime)} reset`);
  await Bun.sleep(1000);
  must((await set(DROWSY, 2)).ok, `[${lang}] inject ${DROWSY} = 2`);
  await Bun.sleep(1500);
  must((await target()) === on(withChime), `[${lang}] ${out(withChime)} = ${JSON.stringify(on(withChime))} (drowsy)`);
  must((await set(DROWSY, 1)).ok, `[${lang}] inject ${DROWSY} = 1`);
  await Bun.sleep(1500);
  must((await target()) === off(withChime), `[${lang}] ${out(withChime)} = ${JSON.stringify(off(withChime))} (alert again)`);
  must((await post(`${O}/runs/${r.id}/stop`, {})).ok, `[${lang}] stop requested`);
  while ((r = await get(`${O}/runs/${r.id}`)).state === "stopping" || r.state === "running") await Bun.sleep(100);
  must(r.state === "stopped", `[${lang}] run stopped`);
}
console.log(`vss-custom gate phase ${PHASE}: PASS (${RELEASE}, ${LANGS.join(" ")})`);
