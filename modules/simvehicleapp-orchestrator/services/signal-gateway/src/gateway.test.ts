import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { createGatewayHandler, playerSet } from "./app.ts";
import { type Broker, BrokerRejected, type BrokerUpdate, type Field } from "./broker.ts";
import { Catalog, indexVss } from "./catalog.ts";
import { connectPacket, parsePackets, parsePublish, publishPacket, subscribePacket } from "./mqtt.ts";
import { Player, type PlayerIo } from "./player.ts";
import type { ProviderApi, ProviderMessage, ProviderStream } from "./provider.ts";
import { fromDatapoint, toDatapoint } from "./values.ts";

const vss40 = JSON.parse(readFileSync(`${fixturesDir}vss/vss_rel_4.0.json`, "utf8"));
const signals = indexVss(vss40);
const meta = (path: string) => signals.get(path)!;
const contracts = new ContractValidator();
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;

describe("VSS catalog index", () => {
  test("a custom model that gained a signal is reloaded once on a miss, at most every refreshMs (ADR-0052)", async () => {
    let doc: unknown = { Vehicle: { type: "branch", children: { A: { type: "sensor", datatype: "uint8" } } } };
    let loads = 0;
    let t = 0;
    const c = new Catalog(async () => (loads++, doc), { refreshMs: 5000, now: () => t });
    expect([...(await c.signalsWith("v4.0-acme", ["Vehicle.A"])).keys()]).toEqual(["Vehicle.A"]);
    doc = { Vehicle: { type: "branch", children: { A: { type: "sensor", datatype: "uint8" }, B: { type: "actuator", datatype: "boolean" } } } };
    expect((await c.signalsWith("v4.0-acme", ["Vehicle.A"])).has("Vehicle.B")).toBe(false); // nothing missing ⇒ cached
    expect((await c.signalsWith("v4.0-acme", ["Vehicle.B"])).get("Vehicle.B")?.type).toBe("actuator"); // miss ⇒ reload
    expect(loads).toBe(2);
    t = 1000;
    expect((await c.signalsWith("v4.0-acme", ["Vehicle.Nope"])).has("Vehicle.Nope")).toBe(false);
    expect(loads).toBe(2); // within refreshMs of the last reload
    t = 6000;
    await c.signalsWith("v4.0-acme", ["Vehicle.Nope"]);
    expect(loads).toBe(3);
  });

  test("leaf signals with type, datatype, limits and allowed values", () => {
    expect(meta("Vehicle.Speed")).toMatchObject({ type: "sensor", datatype: "float", unit: "km/h" });
    expect(meta("Vehicle.Body.Lights.Hazard.IsSignaling")).toMatchObject({ type: "actuator", datatype: "boolean" });
    expect(meta("Vehicle.Body.Windshield.Front.Wiping.Mode").allowed).toContain("SLOW");
    expect(signals.has("Vehicle.Body")).toBe(false);
    expect(signals.size).toBeGreaterThan(500);
  });
});

describe("values ⇄ kuksa.val.v1 Datapoint", () => {
  test("datatypes map to the proto oneof; integers are range-checked; int64 stays exact", () => {
    expect(toDatapoint(meta("Vehicle.Speed"), 130)).toEqual({ ok: true, datapoint: { float: 130 } });
    expect(toDatapoint(meta("Vehicle.Body.Lights.Hazard.IsSignaling"), true)).toEqual({ ok: true, datapoint: { bool: true } });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "uint8" }, 255)).toEqual({ ok: true, datapoint: { uint32: 255 } });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "uint8" }, 256)).toMatchObject({ ok: false });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "int8" }, 1.5)).toMatchObject({ ok: false });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "int64" }, "9007199254740993")).toEqual({ ok: true, datapoint: { int64: "9007199254740993" } });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "string[]" }, ["a", "b"])).toEqual({ ok: true, datapoint: { string_array: { values: ["a", "b"] } } });
    expect(toDatapoint(meta("Vehicle.Speed"), "fast")).toMatchObject({ ok: false });
  });

  test("allowed values and min/max are enforced", () => {
    expect(toDatapoint(meta("Vehicle.Body.Windshield.Front.Wiping.Mode"), "TURBO")).toMatchObject({ ok: false, message: expect.stringContaining("TURBO is not one of OFF") });
    expect(toDatapoint({ path: "X", type: "sensor", datatype: "float", min: 0, max: 100 }, 101)).toMatchObject({ ok: false, message: expect.stringContaining("maximum") });
  });

  test("decoded datapoints become JSON values", () => {
    expect(fromDatapoint({ value: "float", float: 42.5 })).toBe(42.5);
    expect(fromDatapoint({ value: "uint64", uint64: "18446744073709551615" })).toBe("18446744073709551615");
    expect(fromDatapoint({ value: "bool_array", bool_array: { values: [true, false] } })).toEqual([true, false]);
    expect(fromDatapoint(null)).toBeNull();
  });
});

describe("MQTT 3.1.1 packets", () => {
  test("SUBSCRIBE bytes; PUBLISH parsed across split and joined reads", () => {
    expect([...subscribePacket(1, "a/#")]).toEqual([0x82, 8, 0, 1, 0, 3, 97, 47, 35, 0]);
    const p1 = publishPacket("sv/hmi", '{"title":"Overspeed"}');
    const p2 = publishPacket("sv/x", "1");
    const joined = Uint8Array.from([...p1, ...p2.slice(0, 3)]);
    const first = parsePackets(joined);
    expect(first.packets).toHaveLength(1);
    expect(parsePublish(first.packets[0]!)).toEqual({ topic: "sv/hmi", payload: '{"title":"Overspeed"}' });
    const second = parsePackets(Uint8Array.from([...first.rest, ...p2.slice(3)]));
    expect(parsePublish(second.packets[0]!)).toEqual({ topic: "sv/x", payload: "1" });
    expect(second.rest).toHaveLength(0);
  });

  test("CONNECT and PUBLISH (QoS 0) bytes", () => {
    expect([...connectPacket("c")]).toEqual([0x10, 13, 0, 4, 77, 81, 84, 84, 4, 2, 0, 30, 0, 1, 99]);
    expect([...publishPacket("a/b", "ON")]).toEqual([0x30, 7, 0, 3, 97, 47, 98, 79, 78]);
    const big = publishPacket("t", "x".repeat(200));
    expect([...big.slice(0, 3)]).toEqual([0x30, 0xcb, 0x01]); // remaining length 2 + 1 + 200 = 203 in two bytes
  });
});

/** Virtual clock for the player. */
function fakeIo() {
  let t = 0;
  const log: string[] = [];
  const io: PlayerIo = {
    async set(_r, path, field, value) {
      log.push(`${t} set ${path}.${field}=${JSON.stringify(value)}`);
    },
    async publish(topic, payload) {
      log.push(`${t} pub ${topic} ${payload}`);
    },
    async sleep(ms) {
      t += ms;
    },
    now: () => t,
  };
  return { io, log };
}

describe("scenario player (M08-T07)", () => {
  test("initial at once, inputs at their time in order, topic payloads like the runtime", async () => {
    const { io, log } = fakeIo();
    const player = new Player(io);
    const { finished } = player.play("p1", "v4.0", {
      name: "Overspeed",
      until: 5000,
      initial: { "Vehicle.Speed": 100 },
      inputs: [
        { t: 2000, topic: "vehicle/cmd", value: { on: true } },
        { t: 1000, path: "Vehicle.Speed", value: 130 },
        { t: 2000, topic: "vehicle/cmd", value: "ON" },
      ],
    });
    const done = await finished;
    expect(log).toEqual(['0 set Vehicle.Speed.value=100', '1000 set Vehicle.Speed.value=130', '2000 pub vehicle/cmd {"on":true}', "2000 pub vehicle/cmd ON"]);
    expect(done).toMatchObject({ state: "done", played: 4, total: 4 });
  });

  test("inputs never play early: timers that wake early sleep again; a wall-clock step does not move them", async () => {
    let mono = 0;
    let wall = 1_000_000;
    const at: number[] = [];
    const player = new Player({
      async set() {
        at.push(mono);
      },
      async publish() {},
      async sleep(ms) {
        const slept = Math.max(1, Math.round(ms * 0.95)); // wakes 5 % early
        mono += slept;
        wall += slept + (mono > 1500 && wall < 2_000_000 ? 1_000_000 : 0); // the wall clock steps once
      },
      now: () => wall,
      monotonic: () => mono,
    });
    await player.play("p", "v4.0", { name: "S", until: 3000, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 1 }, { t: 3000, path: "Vehicle.Speed", value: 2 }] }).finished;
    expect(at[0]).toBeGreaterThanOrEqual(1000);
    expect(at[0]).toBeLessThan(1005);
    expect(at[1]).toBeGreaterThanOrEqual(3000);
    expect(at[1]).toBeLessThan(3005);
  });

  test("a new playback stops the previous one; a failed write ends it as failed", async () => {
    const { io } = fakeIo();
    const player = new Player({ ...io, sleep: () => new Promise((r) => setTimeout(r, 5)) });
    const first = player.play("a", "v4.0", { name: "A", until: 9000, inputs: [{ t: 9000, path: "Vehicle.Speed", value: 1 }] });
    player.play("b", "v4.0", { name: "B", until: 0, inputs: [] });
    expect((await first.finished).id).toBe("b");
    const failing = new Player({ ...io, set: async () => Promise.reject(new Error("refused")) });
    expect(await failing.play("c", "v4.0", { name: "C", until: 0, initial: { "Vehicle.Speed": 1 }, inputs: [] }).finished).toMatchObject({ state: "failed", error: "refused" });
  });
});

/** In-memory databroker: current values + targets, subscriptions fire on set. */
function fakeBroker() {
  const store = new Map<string, unknown>();
  const subs = new Set<{ paths: string[]; targets: string[]; on: (u: BrokerUpdate[]) => void }>();
  const sets: string[] = [];
  const broker: Broker = {
    async get(paths, targets) {
      return [
        ...paths.filter((p) => store.has(`${p}#value`)).map((p) => ({ path: p, field: "value" as Field, value: store.get(`${p}#value`), ts: 1 })),
        ...targets.filter((p) => store.has(`${p}#target`)).map((p) => ({ path: p, field: "target" as Field, value: store.get(`${p}#target`), ts: 1 })),
      ];
    },
    async set(path, field, dp) {
      const value = fromDatapoint({ value: Object.keys(dp)[0], ...dp });
      if (path === "Vehicle.Body.Trunk.Rear.IsOpen" && field === "value") throw new BrokerRejected("ACCESS_DENIED");
      sets.push(`${path}.${field}=${JSON.stringify(value)}`);
      store.set(`${path}#${field}`, value);
      for (const s of subs) if ((field === "value" ? s.paths : s.targets).includes(path)) s.on([{ path, field, value, ts: 2 }]);
    },
    subscribe(paths, targets, on) {
      const s = { paths, targets, on };
      subs.add(s);
      return () => subs.delete(s);
    },
    close() {},
  };
  return { broker, store, sets, subs };
}

function gateway(b = fakeBroker()) {
  const catalog = new Catalog(async () => vss40);
  const { io } = fakeIo();
  const player = new Player({ ...io, set: playerSet(() => b.broker, catalog) });
  const handler = createGatewayHandler({ broker: (r) => (r === "v4.0" ? b.broker : undefined), catalog, player, newId: () => "play_1", now: () => 7, heartbeatMs: 10 });
  const call = (method: string, path: string, body?: unknown, signal?: AbortSignal) =>
    handler(new Request(`http://g${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}), ...(signal ? { signal } : {}) }), ctx);
  return { ...b, call, player };
}

async function readEvents(res: Response, count: number) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const events: { event: string; data: unknown }[] = [];
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value);
    let i = text.indexOf("\n\n");
    while (i >= 0) {
      const block = text.slice(0, i);
      text = text.slice(i + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) events.push({ event, data: JSON.parse(data) });
      i = text.indexOf("\n\n");
    }
  }
  reader.cancel();
  return events;
}

/** A gateway with a shared databroker and run sandboxes (ADR-0057). */
function sandboxed() {
  const shared = fakeBroker();
  const boxes = new Map<string, ReturnType<typeof fakeBroker>>();
  const forgotten: string[] = [];
  const box = (s: string) => boxes.get(s) ?? (boxes.set(s, fakeBroker()), boxes.get(s)!);
  const catalog = new Catalog(async () => vss40);
  const { io } = fakeIo();
  const handler = createGatewayHandler({
    broker: (r, s) => (r !== "v4.0" ? undefined : s ? box(s).broker : shared.broker),
    forget: (s) => forgotten.push(s),
    catalog,
    player: new Player({ ...io, set: playerSet(() => shared.broker, catalog) }),
    sandboxPlayer: (s) => new Player({ ...io, set: playerSet(() => box(s).broker, catalog) }),
    newId: () => "play_1",
    now: () => 7,
  });
  const call = (method: string, path: string, body?: unknown) => handler(new Request(`http://g${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), ctx);
  return { shared, box, forgotten, call };
}

/** A databroker's kuksa.val.v2 provider side: ids by path, one claim per actuator, scripted actuations. */
function fakeProviderApi() {
  const written: unknown[] = [];
  const claimed = new Set<string>();
  let push: ((m: ProviderMessage) => void) | null = null;
  let fail: ((e: Error & { code?: number }) => void) | null = null;
  let cancelled = 0;
  const api: ProviderApi = {
    idOf: async (path) => (path === "Vehicle.Body.Lights.Hazard.IsSignaling" ? 65 : 99),
    open(): ProviderStream {
      return {
        write(msg) {
          written.push(msg);
          const claim = (msg as { provide_actuation_request?: { actuator_identifiers: { path: string }[] } }).provide_actuation_request;
          if (claim) {
            const paths = claim.actuator_identifiers.map((x) => x.path);
            if (paths.some((x) => claimed.has(x))) queueMicrotask(() => fail?.(Object.assign(new Error("exists"), { code: 6 })));
            else {
              for (const x of paths) claimed.add(x);
              queueMicrotask(() => push?.({ provide_actuation_response: {} }));
            }
          }
        },
        on(event: string, cb: never) {
          if (event === "data") push = cb;
          else fail = cb;
        },
        cancel() {
          cancelled++;
          claimed.clear();
        },
      } as ProviderStream;
    },
    close() {},
  };
  return { api, written, claimed, actuate: (id: number, value: unknown) => push?.({ batch_actuate_stream_request: { actuate_requests: [{ signal_id: { id }, value }] } }), cancelled: () => cancelled };
}

describe("kuksa.val.v2 provider (ADR-0047 §2, M14 #5)", () => {
  const HZ = "Vehicle.Body.Lights.Hazard.IsSignaling";
  const setup = () => {
    const pv = fakeProviderApi();
    const catalog = new Catalog(async () => vss40);
    const { io } = fakeIo();
    const b = fakeBroker();
    const handler = createGatewayHandler({ broker: (r) => (r === "v4.0" ? b.broker : undefined), providerApi: () => pv.api, catalog, player: new Player({ ...io, set: playerSet(() => b.broker, catalog) }), newId: () => "p" });
    const call = (body: unknown) => handler(new Request("http://g/mirror", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ctx);
    return { pv, b, call };
  };

  test("PUT /mirror with api kuksa.val.v2 claims the actuators; an actuation is accepted and published as current", async () => {
    const { pv, b, call } = setup();
    expect((await call({ release: "v4.0", paths: [HZ], api: "kuksa.val.v2" })).status).toBe(204);
    expect(pv.claimed.has(HZ)).toBe(true);
    expect(b.subs.size).toBe(0); // no v1 mirror subscription for a v2 app
    pv.actuate(65, { bool: true });
    expect(pv.written.slice(1)).toEqual([
      { batch_actuate_stream_response: { signal_id: { id: 65 }, error: { code: "ERROR_CODE_OK", message: "" } } },
      { publish_values_request: { request_id: 1, data_points: { 65: { value: { bool: true } } } } },
    ]);
    // An actuator it does not provide is refused, not published.
    pv.actuate(7, { bool: true });
    expect(pv.written.at(-1)).toMatchObject({ batch_actuate_stream_response: { error: { code: "ERROR_CODE_NOT_FOUND" } } });
    // The run ends: the claim is released.
    expect((await call({ release: "v4.0", paths: [], api: "kuksa.val.v2" })).status).toBe(204);
    expect(pv.cancelled()).toBe(1);
    expect(pv.claimed.size).toBe(0);
  });

  test("publish false: actuations are accepted but the current value stays (no vehicle answers)", async () => {
    const { pv, call } = setup();
    expect((await call({ release: "v4.0", paths: [HZ], api: "kuksa.val.v2", publish: false })).status).toBe(204);
    pv.actuate(65, { bool: true });
    expect(pv.written.slice(1)).toEqual([{ batch_actuate_stream_response: { signal_id: { id: 65 }, error: { code: "ERROR_CODE_OK", message: "" } } }]);
    // Switching back on the same actuators keeps the claim: no new stream, publishing again.
    expect((await call({ release: "v4.0", paths: [HZ], api: "kuksa.val.v2" })).status).toBe(204);
    expect(pv.cancelled()).toBe(0);
    pv.actuate(65, { bool: false });
    expect(pv.written.at(-1)).toEqual({ publish_values_request: { request_id: 1, data_points: { 65: { value: { bool: false } } } } });
  });

  test("another provider holds an actuator ⇒ 409 provider_refused; a bad api ⇒ 400; v1 stays the default", async () => {
    const { pv, b, call } = setup();
    pv.claimed.add(HZ);
    const refused = await call({ release: "v4.0", paths: [HZ], api: "kuksa.val.v2" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).message).toContain("another provider already holds");
    expect((await call({ release: "v4.0", paths: [HZ], api: "v3" })).status).toBe(400);
    expect((await call({ release: "v4.0", paths: [HZ] })).status).toBe(204);
    expect(b.subs.size).toBe(1); // v1 mirror
  });
});

describe("Messages (ADR-0058 §6, M18-T05)", () => {
  test("GET /messages streams the MQTT messages under the app's topic prefix; a bad prefix is refused", async () => {
    let deliver: ((t: string, p: string) => void) | null = null;
    let filter = "";
    let stopped = 0;
    const catalog = new Catalog(async () => vss40);
    const { io } = fakeIo();
    const handler = createGatewayHandler({
      broker: () => undefined,
      subscribe: (f, on) => ((filter = f), (deliver = on), () => void stopped++),
      catalog,
      player: new Player({ ...io, set: async () => {} }),
      newId: () => "p",
      now: () => 9,
      heartbeatMs: 10,
    });
    expect((await handler(new Request("http://g/messages?prefix=a/../b"), ctx)).status).toBe(400);
    const abort = new AbortController();
    const res = await handler(new Request("http://g/messages?prefix=simvehicleapp/lka", { signal: abort.signal }), ctx);
    expect(filter).toBe("simvehicleapp/lka/#");
    const pending = readEvents(res, 1);
    deliver!("simvehicleapp/lka/hmi", '{"title":"Overspeed"}');
    expect((await pending)[0]).toEqual({ event: "message", data: { topic: "simvehicleapp/lka/hmi", payload: '{"title":"Overspeed"}', ts: 9 } });
    abort.abort();
    await Bun.sleep(5);
    expect(stopped).toBe(1);
  });
});

describe("sandboxes of runs (ADR-0057, M17-T05)", () => {
  test("inject, snapshot, mirror and play go to the run's own databroker; another run and the shared one see nothing", async () => {
    const g = sandboxed();
    const a = "toolchain-cpp:56000";
    const b = "toolchain-cpp:56001";
    expect((await g.call("POST", "/signals", { release: "v4.0", sandbox: a, path: "Vehicle.Speed", value: 130, field: "value" })).status).toBe(200);
    expect(g.box(a).sets).toEqual(["Vehicle.Speed.value=130"]);
    expect(g.box(b).sets).toEqual([]);
    expect(g.shared.sets).toEqual([]);
    const snap = await (await g.call("GET", `/snapshot?release=v4.0&sandbox=${a}&paths=Vehicle.Speed`)).json();
    expect(snap.updates).toMatchObject([{ path: "Vehicle.Speed", value: 130 }]);
    expect((await (await g.call("GET", `/snapshot?release=v4.0&sandbox=${b}&paths=Vehicle.Speed`)).json()).updates).toEqual([]);
    // mirror per sandbox
    expect((await g.call("PUT", "/mirror", { release: "v4.0", sandbox: a, paths: ["Vehicle.Body.Lights.Hazard.IsSignaling"] })).status).toBe(204);
    await g.call("POST", "/signals", { release: "v4.0", sandbox: b, path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: true, field: "target" });
    await g.call("POST", "/signals", { release: "v4.0", sandbox: a, path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: true, field: "target" });
    await Bun.sleep(1);
    expect(g.box(a).store.get("Vehicle.Body.Lights.Hazard.IsSignaling#value")).toBe(true);
    expect(g.box(b).store.has("Vehicle.Body.Lights.Hazard.IsSignaling#value")).toBe(false);
    // play per sandbox
    const play = await g.call("POST", "/play", { release: "v4.0", sandbox: b, scenario: { scenarioVersion: "1.0.0", name: "S", until: 0, initial: { "Vehicle.Speed": 42 }, inputs: [] } });
    expect(play.status).toBe(202);
    await Bun.sleep(2);
    expect(g.box(b).store.get("Vehicle.Speed#value")).toBe(42);
    expect(g.box(a).store.get("Vehicle.Speed#value")).toBe(130);
    expect((await g.call("GET", `/play?sandbox=${b}`)).status).toBe(200);
    expect((await g.call("GET", "/play")).status).toBe(404); // the shared player played nothing
    // the run ends: its mirror stops and the gateway forgets its databroker
    expect((await g.call("PUT", "/mirror", { release: "v4.0", sandbox: a, paths: [] })).status).toBe(204);
    expect(g.box(a).subs.size).toBe(0);
    expect(g.forgotten).toEqual([a]);
  });

  test("a sandbox is only ever a toolchain host and port (no other internal address)", async () => {
    const g = sandboxed();
    for (const s of ["databroker:55555", "toolchain-cpp", "evil.example:80", "toolchain-cpp:5600/x"]) {
      expect((await g.call("POST", "/signals", { release: "v4.0", sandbox: s, path: "Vehicle.Speed", value: 1, field: "value" })).status).toBe(400);
      expect((await g.call("GET", `/signals?release=v4.0&sandbox=${encodeURIComponent(s)}&paths=Vehicle.Speed`)).status).toBe(400);
      expect((await g.call("PUT", "/mirror", { release: "v4.0", sandbox: s, paths: [] })).status).toBe(400);
      expect((await g.call("GET", `/play?sandbox=${encodeURIComponent(s)}`)).status).toBe(400);
    }
  });
});

describe("HTTP API (openapi/signal-gateway.v1.yaml)", () => {
  test("GET /signals streams the current value and target first, then changes; closing cancels the subscription", async () => {
    const g = gateway();
    g.store.set("Vehicle.Speed#value", 100);
    g.store.set("Vehicle.Body.Lights.Hazard.IsSignaling#target", false);
    const abort = new AbortController();
    const res = await g.call("GET", "/signals?release=v4.0&paths=Vehicle.Speed,Vehicle.Body.Lights.Hazard.IsSignaling", undefined, abort.signal);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const pending = readEvents(res, 3);
    await Bun.sleep(5);
    await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Speed", value: 130, field: "value" });
    const events = await pending;
    for (const e of events) contracts.assert("signal-update", e.data);
    expect(events.map((e) => e.data)).toEqual([
      { path: "Vehicle.Speed", ts: 1, value: 100, field: "value" },
      { path: "Vehicle.Body.Lights.Hazard.IsSignaling", ts: 1, value: false, field: "target" },
      { path: "Vehicle.Speed", ts: 2, value: 130, field: "value" },
    ]);
    abort.abort();
    await Bun.sleep(5);
    expect(g.subs.size).toBe(0);
  });

  test("only catalog paths of a release served by a databroker; values are checked before the databroker", async () => {
    const g = gateway();
    expect((await g.call("GET", "/signals?release=v4.0&paths=Vehicle.Nope")).status).toBe(400);
    expect((await g.call("GET", "/signals?release=v9.9&paths=Vehicle.Speed")).status).toBe(503);
    expect((await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Speed", value: true, field: "value" })).status).toBe(400);
    expect((await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Speed", value: 1, field: "target" })).status).toBe(400);
    const refused = await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Body.Trunk.Rear.IsOpen", value: true, field: "value" });
    expect(refused.status).toBe(422);
    expect((await refused.json()).message).toContain("ACCESS_DENIED");
    const ok = await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: true, field: "target" });
    const written = await ok.json();
    expect(written).toEqual({ path: "Vehicle.Body.Lights.Hazard.IsSignaling", ts: 7, value: true, field: "target" });
    contracts.assert("signal-update", written);
    expect(g.sets).toEqual(["Vehicle.Body.Lights.Hazard.IsSignaling.target=true"]);
  });

  test("PUT /mirror copies actuator targets to their current value (provider role); an empty list stops it", async () => {
    const g = gateway();
    expect((await g.call("PUT", "/mirror", { release: "v4.0", paths: ["Vehicle.Speed"] })).status).toBe(400);
    expect((await g.call("PUT", "/mirror", { release: "v4.0", paths: ["Vehicle.Body.Lights.Hazard.IsSignaling"] })).status).toBe(204);
    await g.call("POST", "/signals", { release: "v4.0", path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: true, field: "target" });
    await Bun.sleep(1);
    expect(g.store.get("Vehicle.Body.Lights.Hazard.IsSignaling#value")).toBe(true);
    await g.call("PUT", "/mirror", { release: "v4.0", paths: [] });
    expect(g.subs.size).toBe(0);
  });

  test("POST /play with observe records what the app does during the playback, not the playback's own values", async () => {
    const g = gateway();
    const H = "Vehicle.Body.Lights.Hazard.IsSignaling";
    expect((await g.call("POST", "/play", { release: "v4.0", observe: ["Vehicle.Nope"], scenario: { scenarioVersion: "1.0.0", name: "x", until: 1, inputs: [] } })).status).toBe(400);
    const res = await g.call("POST", "/play", { release: "v4.0", observe: [H, "Vehicle.Speed"], scenario: { scenarioVersion: "1.0.0", name: "S", until: 3000, initial: { "Vehicle.Speed": 100 }, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 130 }] } });
    expect(res.status).toBe(202);
    const { startedAt } = await res.json();
    // The app reacts: it sets the hazard target (fake broker updates are stamped 2: re-stamp them like a real broker)
    const [sub] = [...g.subs].filter((x) => x.paths.includes(H));
    expect(sub).toBeDefined();
    sub!.on([{ path: H, field: "target", value: true, ts: startedAt + 2010 }, { path: "Vehicle.Speed", field: "value", value: 130, ts: startedAt + 1000 }, { path: H, field: "value", value: false, ts: startedAt - 5 }]);
    const pb = await (await g.call("GET", "/play")).json();
    expect(pb.observed).toEqual([{ t: 2010, path: H, field: "target", value: true }]);
  });

  test("POST /play validates the whole scenario, then plays it on the databroker", async () => {
    const g = gateway();
    const bad = await g.call("POST", "/play", { release: "v4.0", scenario: { scenarioVersion: "1.0.0", name: "x", until: 10, inputs: [{ t: 1, path: "Vehicle.Speed", value: "fast" }] } });
    expect(bad.status).toBe(400);
    expect((await g.call("GET", "/play")).status).toBe(404);
    const res = await g.call("POST", "/play", { release: "v4.0", scenario: { scenarioVersion: "1.0.0", name: "Overspeed", until: 3000, initial: { "Vehicle.Speed": 100 }, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 130 }] } });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ id: "play_1", state: "playing", total: 2 });
    await Bun.sleep(5);
    expect(g.sets).toEqual(["Vehicle.Speed.value=100", "Vehicle.Speed.value=130"]);
    expect(await (await g.call("GET", "/play")).json()).toMatchObject({ state: "done", played: 2 });
    expect((await g.call("DELETE", "/play")).status).toBe(204);
  });
});
