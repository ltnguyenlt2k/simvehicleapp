/**
 * M18-T09 gate (ADR-0060), run by `m18-deploy.sh` on sv-internal: real orchestrator, vehicle-gateway, signal-gateway
 * and toolchain; the deploy target is a second databroker the gate feeds (Speed) and provides for (the hazard), as the
 * vehicle's layers would. GW-A: Speed > 120 held 2 s ⇒ hazard on.
 */
import { readFileSync } from "node:fs";
import { grpcBroker } from "../services/signal-gateway/src/broker.ts";
import { grpcProviderApi, provideActuators } from "../services/signal-gateway/src/provider.ts";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const slug = process.env.SLUG ?? "";
const address = `${process.env.TARGET}:55555`;
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";
const owner = { userId: "gate", workspaceId: "gate-ws" };

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });

// The target's layers: a Speed feeder and a provider for the hazard (publishes what it is asked to set).
const feeder = grpcBroker(address);
for (let i = 0; i < 50; i++) {
  try {
    await feeder.set("Vehicle.Speed", "value", { float: 0 });
    break;
  } catch {
    await Bun.sleep(200);
  }
}
const hazard = async () => (await feeder.get([HAZARD], [])).find((u) => u.field === "value")?.value;
const speed = async (v: number) => feeder.set("Vehicle.Speed", "value", { float: v });

const graph = JSON.parse(readFileSync("/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A/graph.json", "utf8"));
let p = await (await post(`${O}/projects`, { slug, name: "Gate deploy", language: "cpp", vssRelease: "v4.0" })).json();
const t0 = Date.now();
while (p.status === "creating" && Date.now() - t0 < 600_000) {
  await Bun.sleep(2000);
  p = await get(`${O}/projects/${p.id}`);
}
must(p.status === "ready", `app ${slug} ready`);
const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph] })).json();
await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
must((await get(`${O}/projects/${p.id}/generations/${queued.id}`)).success, "SynCode GW-A");

const target = await (await post(`${O}/deploy-targets`, { ...owner, workspaceId: owner.workspaceId, name: `bench ${slug}`, address, tls: false, vssRelease: "v4.0" })).json();
must(target.id && target.hasToken === false, `deploy target ${target.id} (${address})`);
const test = await (await post(`${O}/deploy-targets/${target.id}/test`, { workspaceId: owner.workspaceId, paths: ["Vehicle.Speed", HAZARD, "Vehicle.Acme.Nope"] })).json();
must(test.reachable === true && JSON.stringify(test.missing) === '["Vehicle.Acme.Nope"]', `Test connection: ${test.server?.name} ${test.server?.version}, missing ${JSON.stringify(test.missing)}`);

const deploy = async (mode: string) => {
  let r = await (await post(`${O}/projects/${p.id}/deployments`, { targetId: target.id, mode, owner })).json();
  must(r.deploy?.mode === mode && /^vehicle-gateway:\d+$/.test(r.sandbox ?? ""), `deployed ${mode} through ${r.sandbox}`);
  for (let i = 0; i < 300 && r.state === "starting"; i++) {
    await Bun.sleep(100);
    r = await get(`${O}/runs/${r.id}`);
  }
  must(r.state === "running", `deployment ${r.id} running (${r.state})`);
  return r;
};
const stop = async (id: string) => {
  await post(`${O}/runs/${id}/stop`, {});
  let r;
  while ((r = await get(`${O}/runs/${id}`)).state === "stopping" || r.state === "running") await Bun.sleep(100);
  must(r.state === "stopped", `deployment ${id} stopped`);
};
const overspeed = async () => {
  await speed(100);
  await Bun.sleep(500);
  await speed(130);
  await Bun.sleep(3000);
};

// 1. read-only: the app reads the target's Speed, its Actuate is refused by the route and audited.
const ro = await deploy("read-only");
const inject = await post(`${G}/signals`, { release: "v4.0", sandbox: ro.sandbox, path: "Vehicle.Speed", value: 130, field: "value" });
must(inject.status === 409 && (await inject.json()).error === "SIMULATED_INPUT_DISABLED", "inject on a deployment ⇒ 409 SIMULATED_INPUT_DISABLED");
const play = await post(`${G}/play`, { release: "v4.0", sandbox: ro.sandbox, scenario: { scenarioVersion: "1.0.0", name: "x", until: 0, inputs: [] } });
must(play.status === 409, "Play on a deployment ⇒ 409");
const snap = await get(`${G}/snapshot?release=v4.0&sandbox=${ro.sandbox}&paths=Vehicle.Speed`);
must(Array.isArray(snap.updates), "the Live tab reads the target's signals through the route");
await overspeed();
must((await hazard()) !== true, "read-only: the hazard stays off on the target");
const audit = await get(`${O}/runs/${ro.id}/audit`);
must(audit.audit?.some((a: { method: string; allowed: boolean }) => /\/(Batch)?Actuate$/.test(a.method) && !a.allowed), `read-only: the app's Actuate refused and audited (${JSON.stringify(audit.audit?.at(-1))})`);
await stop(ro.id);

// 2. read-write: the target's provider takes the app's Actuate and publishes the value.
await speed(0);
const provider = await provideActuators(grpcProviderApi(address), [HAZARD], { warn: (m: string, d?: object) => console.log("provider:", m, d ?? "") });
const rw = await deploy("read-write");
await overspeed();
must((await hazard()) === true, "read-write: the app switched the hazard on, on the target");
const audit2 = await get(`${O}/runs/${rw.id}/audit`);
must(audit2.audit?.some((a: { allowed: boolean; signal?: string }) => a.allowed && (a.signal === HAZARD || a.signal?.startsWith("#"))), "read-write: the write is audited");
await stop(rw.id);
provider.stop();
const del = await fetch(`${O}/deploy-targets/${target.id}?workspaceId=${owner.workspaceId}`, { method: "DELETE", headers: h });
must(del.status === 204, "deploy target deleted");
feeder.close();
process.exit(0);
