/**
 * M17 runtime gate (ADR-0057, M17-T05), run by `m17-runtime.sh` on the dev stack's sv-internal network with the
 * orchestrator restarted on SV_RUN_SANDBOX=1, 1 run per user, a 45 s time limit and 1 extension.
 *
 * Two apps (GW-A: Speed > 120 km/h held 2 s ⇒ hazard on) of two users run at once, each on a databroker of its own:
 * Speed 130 into A's sandbox switches A's hazard only. A running app is not started twice.
 * B is extended once (expiresAt + 45 s), a second Extend is refused; A stops by itself at its limit (stopReason
 * expired) while B still runs; user 2 (running B) cannot start A (RUN_QUOTA_EXCEEDED, scope user); B stops on request.
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
const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms: number) => {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < ms) {
    await Bun.sleep(250);
    v = await read();
  }
  return v;
};

// 1. two apps, SynCode GW-A in each
const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
const scenario = Bun.YAML.parse(readFileSync(`${golden}/scenario.yaml`, "utf8"));
const app = async (suffix: string) => {
  let p = await (await post(`${O}/projects`, { slug: `${slug}-${suffix}`, name: `Gate M17 ${suffix}`, language: "cpp", vssRelease: "v4.0" })).json();
  p = await until(() => get(`${O}/projects/${p.id}`), (x) => x.status !== "creating", 300_000);
  must(p.status === "ready", `app ${p.slug} ready`);
  const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph], scenarios: [{ workflowId: graph.workflowId, scenario }] })).json();
  await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
  const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
  must(gen.success, `SynCode GW-A in ${p.slug}: ${JSON.stringify(gen.verification)}`);
  return { project: p, gen };
};
const a = await app("a");
const b = await app("b");

// 2. two users, two runs at once, each with a databroker of its own
const start = async (x: typeof a, userId: string) => post(`${O}/projects/${x.project.id}/runs`, { generationId: x.gen.id, owner: { userId, workspaceId: "gate" } });
const ra = await (await start(a, "gate-user-1")).json();
const rb = await (await start(b, "gate-user-2")).json();
must(ra.sandbox && rb.sandbox && ra.sandbox !== rb.sandbox, `runs ${ra.id} and ${rb.id} on databrokers of their own: ${ra.sandbox}, ${rb.sandbox}`);
const runA = await until(() => get(`${O}/runs/${ra.id}`), (r) => r.state !== "starting", 30_000);
const runB = await until(() => get(`${O}/runs/${rb.id}`), (r) => r.state !== "starting", 30_000);
must(runA.state === "running" && runB.state === "running", `both apps running at once (A expires in ${Math.round((runA.expiresAt - Date.now()) / 1000)} s)`);

// 3. inject into A only ⇒ only A's hazard switches
const set = (sandbox: string, path: string, value: unknown, field = "value") => post(`${G}/signals`, { release: "v4.0", sandbox, path, value, field });
const hazard = async (sandbox: string) => {
  const s = await get(`${G}/snapshot?release=v4.0&sandbox=${sandbox}&paths=${HAZARD}`);
  return s.updates.find((u: { field: string }) => u.field === "target")?.value ?? null;
};
for (const s of [ra.sandbox, rb.sandbox]) must((await set(s, "Vehicle.Speed", 100)).ok, `Speed 100 on ${s}`);
await Bun.sleep(500);
must((await set(ra.sandbox, "Vehicle.Speed", 130)).ok, `Speed 130 on A's databroker only, held 3 s`);
await Bun.sleep(3000);
const onA = await hazard(ra.sandbox);
const onB = await hazard(rb.sandbox);
must(onA === true && onB !== true, `hazard target: A ${onA}, B ${onB} (no signal leaks between runs)`);
const shared = await get(`${G}/snapshot?release=v4.0&paths=Vehicle.Speed`);
must(!shared.updates.some((u: { value: unknown }) => u.value === 130), "the shared v4.0 databroker never saw Speed 130");

// 4. one run per app: B is running, nobody starts it again
await post(`${O}/runs/${rb.id}/extend`, {});
const twice = await start(b, "gate-user-1");
must(twice.status === 409 && !Array.isArray(await twice.json()), `starting B again while it runs ⇒ ${twice.status} (one run per app)`);

// 5. Extend B once (a second time is refused); A stops by itself at its limit
const extended = await get(`${O}/runs/${rb.id}`);
must(extended.extensions === 1 && extended.expiresAt > runB.expiresAt + 40_000, `B extended once: +${Math.round((extended.expiresAt - runB.expiresAt) / 1000)} s`);
const again = await post(`${O}/runs/${rb.id}/extend`, {});
must(again.status === 409, `a second Extend is refused (${again.status})`);
const doneA = await until(() => get(`${O}/runs/${ra.id}`), (r) => r.state === "stopped" || r.state === "crashed", 60_000);
must(doneA.state === "stopped" && doneA.stopReason === "expired", `A stopped by itself at its limit: ${doneA.state}, stopReason ${doneA.stopReason}`);
must((await get(`${O}/runs/${rb.id}`)).state === "running", "B still runs (extended)");

// 6. per-user quota: user 2 runs B, so A is refused for them; then stop B
const userQuota = await (await post(`${O}/projects/${a.project.id}/runs`, { generationId: a.gen.id, owner: { userId: "gate-user-2", workspaceId: "gate" } })).json();
must(Array.isArray(userQuota) && userQuota[0]?.code === "RUN_QUOTA_EXCEEDED" && userQuota[0]?.data?.scope === "user", `user 2 (runs B) cannot start A too: ${userQuota[0]?.code ?? JSON.stringify(userQuota).slice(0, 80)}`);
must((await post(`${O}/runs/${rb.id}/stop`, {})).ok, "stop B");
const doneB = await until(() => get(`${O}/runs/${rb.id}`), (r) => r.state === "stopped" || r.state === "crashed", 10_000);
must(doneB.state === "stopped" && doneB.stopReason === "user", `B ${doneB.state} (stopReason ${doneB.stopReason})`);
