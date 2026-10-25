/**
 * Standalone services (ADR-0044 §1, M21 D9), run by `two-apps-mqtt.sh` on sv-internal: two vehicle apps of the same
 * workspace talk over MQTT. App A watches the speed and publishes `on`/`off` on a shared topic; app B subscribes and sets
 * the hazard lights. Both run at once, each with its own databroker sandbox (ADR-0057): the speed is injected into A's
 * sandbox and the hazard is read from B's — nothing but the MQTT message links them.
 */
const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const slug = process.env.SLUG ?? "";
const language = process.env.LANG_ID ?? "cpp";
const release = "v4.0";
const SPEED = "Vehicle.Speed";
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";
const TOPIC = `simvehicleapp/${slug}/overspeed`;

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
const block = (id: string, type: string, name: string, props: Record<string, unknown>) => ({ id, type, name, props, parentId: null, blockVersion: 1 });
const edge = (id: string, from: string, fromHandle: string, to: string) => ({ id, from, fromHandle, to, toHandle: "target" });
const graph = (workflowId: string, name: string, blocks: unknown[], edges: unknown[]) => ({ graphVersion: "1.0.0", workflowId, revision: 1, name, vss: { release }, variables: [], blocks, edges });

const producer = graph(
  "producer",
  "Publish overspeed",
  [
    block("b1", "sv_on_signal_changed", "speed", { path: SPEED, mode: "any", debounceMs: 0, concurrency: "restart" }),
    block("b2", "sv_if", "fast", { condition: "<speed.value> > 120" }),
    block("b3", "sv_mqtt_publish", "on", { topic: TOPIC, payload: "on", payloadType: "text", qos: 1, retain: false }),
    block("b4", "sv_mqtt_publish", "off", { topic: TOPIC, payload: "off", payloadType: "text", qos: 1, retain: false }),
  ],
  [edge("e1", "b1", "source", "b2"), edge("e2", "b2", "then", "b3"), edge("e3", "b2", "else", "b4")],
);
const consumer = graph(
  "consumer",
  "Hazard from overspeed",
  [
    block("b1", "sv_on_mqtt", "alert", { topic: TOPIC, payloadType: "text", concurrency: "queue" }),
    block("b2", "sv_if", "isOn", { condition: '<alert.payload> == "on"' }),
    block("b3", "sv_set_actuator", "hazardOn", { path: HAZARD, value: true, awaitAck: true, onError: "continue" }),
    block("b4", "sv_set_actuator", "hazardOff", { path: HAZARD, value: false, awaitAck: true, onError: "continue" }),
  ],
  [edge("e1", "b1", "source", "b2"), edge("e2", "b2", "then", "b3"), edge("e3", "b2", "else", "b4")],
);

async function app(role: string, g: ReturnType<typeof graph>) {
  let p = await (await post(`${O}/projects`, { slug: `${slug}-${role}`, name: `Gate ${role} ${language}`, language, vssRelease: release })).json();
  const t0 = Date.now();
  while (p.status === "creating" && Date.now() - t0 < 600_000) {
    await Bun.sleep(2000);
    p = await get(`${O}/projects/${p.id}`);
  }
  must(p.status === "ready", `${role}: app ${p.slug} ready`);
  const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [g] })).json();
  await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
  const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
  must(gen.success, `${role}: SynCode ${JSON.stringify(gen.verification)}${gen.success ? "" : ` ${JSON.stringify(gen.diagnostics ?? []).slice(0, 600)}`}`);
  const run = await (await post(`${O}/projects/${p.id}/runs`, {})).json();
  let r = run;
  for (let i = 0; i < 300 && r.state === "starting"; i++) {
    await Bun.sleep(100);
    r = await get(`${O}/runs/${run.id}`);
  }
  must(r.state === "running" && r.sandbox, `${role}: running in its own sandbox (${r.state}, ${r.sandbox})`);
  return { run: r.id as string, sandbox: r.sandbox as string };
}

const hazardOf = async (sandbox: string) => {
  const s = await get(`${G}/snapshot?release=${release}&sandbox=${sandbox}&paths=${HAZARD}`);
  return (s.updates as { field: string; value: unknown }[] | undefined)?.find((u) => u.field === "value")?.value;
};

const a = await app("producer", producer);
const b = await app("consumer", consumer);
must(a.sandbox !== b.sandbox, "the two apps run on different databrokers");
try {
  for (const [speed, want] of [
    [130, true],
    [60, false],
  ] as const) {
    const res = await post(`${G}/signals`, { release, sandbox: a.sandbox, path: SPEED, value: speed, field: "value" });
    must(res.ok, `inject ${SPEED} = ${speed} into the producer's sandbox`);
    let got: unknown;
    for (let i = 0; i < 30 && got !== want; i++) {
      await Bun.sleep(100);
      got = await hazardOf(b.sandbox);
    }
    must(got === want, `consumer's hazard = ${want} (got ${JSON.stringify(got)}) — only through MQTT ${TOPIC}`);
  }
} finally {
  await post(`${O}/runs/${a.run}/stop`, {});
  await post(`${O}/runs/${b.run}/stop`, {});
}
