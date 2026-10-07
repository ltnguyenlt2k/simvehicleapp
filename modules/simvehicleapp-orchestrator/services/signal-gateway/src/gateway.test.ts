import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { createGatewayHandler, playerSet } from "./app.ts";
import { type Broker, BrokerRejected, type BrokerUpdate, type Field } from "./broker.ts";
import { Catalog, indexVss } from "./catalog.ts";
import { connectPacket, publishPacket } from "./mqtt.ts";
import { Player, type PlayerIo } from "./player.ts";
import { fromDatapoint, toDatapoint } from "./values.ts";

const vss40 = JSON.parse(readFileSync(`${fixturesDir}vss/vss_rel_4.0.json`, "utf8"));
const signals = indexVss(vss40);
const meta = (path: string) => signals.get(path)!;
const contracts = new ContractValidator();
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;

describe("VSS catalog index", () => {
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
