import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { compile } from "@simvehicleapp/compiler";
import { fixtureContext } from "@simvehicleapp/compiler/src/golden-ir.ts";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { cast, evaluate, formatFloat32, fromJson, roundHalfAway, simulate, toJson } from "./index.ts";

const ctx = fixtureContext();
const gwa = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/graph.json`, "utf8"));
const irOf = async (graph: unknown) => {
  const r = await compile(graph, ctx);
  if (!r.ir) throw new Error(r.diagnostics.map((d) => d.code).join(", "));
  return r.ir;
};
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";

describe("M5 gate example (analysis/phases/M05 Gate)", () => {
  test("GW-A: Speed 100→130 at 1000, held ⇒ Hazard on at 3000", async () => {
    const r = simulate(await irOf(gwa), { until: 6000, initial: { "Vehicle.Speed": 100, [HAZARD]: false }, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 130 }] });
    expect(r.writes).toEqual([{ t: 3000, path: HAZARD, value: true }]);
  });
  test("GW-A: a speed change at 2500 restarts the window ⇒ Hazard on at 4500", async () => {
    const r = simulate(await irOf(gwa), {
      until: 6000,
      initial: { "Vehicle.Speed": 100, [HAZARD]: false },
      inputs: [
        { t: 1000, path: "Vehicle.Speed", value: 130 },
        { t: 2500, path: "Vehicle.Speed", value: 140 },
      ],
    });
    expect(r.writes).toEqual([{ t: 4500, path: HAZARD, value: true }]);
    expect(r.trace.filter((e) => e.ev === "cancel").map((e) => [e.ts, e.data?.reason])).toEqual([[2500, "restart"]]);
  });
});

describe("trace and determinism (M05-T06)", () => {
  test("every trace event is a valid TraceEvent v1 and the run is reproducible byte for byte", async () => {
    const ir = await irOf(gwa);
    const sc = Bun.YAML.parse(readFileSync(`${fixturesDir}golden/GW-A/scenario.yaml`, "utf8")) as { until: number; initial: Record<string, unknown>; inputs: [] };
    const a = simulate(ir, sc);
    const b = simulate(structuredClone(ir), structuredClone(sc));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const v = new ContractValidator();
    for (const e of a.trace) {
      const r = v.validate("trace-event", e);
      expect(r.errors).toEqual([]);
    }
    expect(a.trace.map((e) => e.seq)).toEqual(a.trace.map((_, i) => i));
    expect(a.trace.every((e, i) => i === 0 || e.ts >= a.trace[i - 1]!.ts)).toBe(true);
  });
});

describe("limits and validation (ADR-0017 §5)", () => {
  test("until is bounded to 24 h; the event cap stops a runaway and reports it", async () => {
    const ir = await irOf(gwa);
    expect(() => simulate(ir, { until: 86_400_001 })).toThrow();
    const inputs = Array.from({ length: 50 }, (_, i) => ({ t: i, path: "Vehicle.Speed", value: i }));
    const r = simulate(ir, { until: 1000, inputs, maxEvents: 20 });
    expect(r.limit).toEqual({ reason: "events", events: 20, t: r.limit!.t });
  });

  test("a write outside the VSS range takes the error path (onError continue ⇒ logged, run goes on)", async () => {
    const g = structuredClone(gwa);
    g.blocks = g.blocks.filter((b: { id: string }) => ["b1", "b3"].includes(b.id));
    g.blocks[1].props = { path: "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", value: "<speedchanged.value> > 0 ? 100 : 0", awaitAck: true, onError: "continue" };
    g.edges = [{ id: "e1", from: "b1", fromHandle: "source", to: "b3", toHandle: "target" }];
    const ir = await irOf(g);
    const r = simulate(ir, { until: 2000, initial: { "Vehicle.Speed": 0 }, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 10 }], model: { "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed": { min: 0, max: 50 } } });
    expect(r.writes).toEqual([]);
    expect(r.trace.find((e) => e.ev === "error")?.data?.message).toContain("outside");
  });

  test("perf: 10 minutes of virtual time (100 ms changes) simulate in under 1 s", async () => {
    const ir = await irOf(gwa);
    const inputs = Array.from({ length: 6000 }, (_, i) => ({ t: i * 100, path: "Vehicle.Speed", value: 100 + (i % 50) }));
    const t0 = performance.now();
    const r = simulate(ir, { until: 600_000, initial: { "Vehicle.Speed": 0 }, inputs });
    const ms = performance.now() - t0;
    expect(r.limit).toBeUndefined();
    expect(ms).toBeLessThan(1000);
  });
});

describe("value semantics (IR_SPEC)", () => {
  test("int64 stays exact; int64/uint64 serialize as decimal strings", () => {
    const big = { $expr: { op: "+", l: { $const: "9223372036854775000", type: "int64" }, r: { $const: "7", type: "int64" }, type: "int64" } };
    const c = { ref: () => 0n, signal: () => undefined, state: () => null, now: () => 0, typeOfRef: () => undefined };
    expect(evaluate(big, c)).toBe(9223372036854775007n);
    expect(toJson(9223372036854775007n, "int64")).toBe("9223372036854775007");
    expect(toJson(80n, "uint8")).toBe(80);
  });
  test("division and modulo are double; float formats with the shortest binary32 digits", () => {
    const c = { ref: () => 0n, signal: () => undefined, state: () => null, now: () => 0, typeOfRef: () => undefined };
    const div = (op: string, l: string, r: string) => evaluate({ $expr: { op, l: { $const: l, type: "int64" }, r: { $const: r, type: "int64" }, type: "double" } }, c);
    expect(div("/", "7", "2")).toBe(3.5);
    expect(div("%", "-7", "2")).toBe(-1);
    expect(div("/", "1", "0")).toBe(Infinity);
    expect(formatFloat32(Math.fround(0.1))).toBe("0.1");
    expect(formatFloat32(Math.fround(120.5))).toBe("120.5");
  });
  test("type.cast rounds half away from zero, NaN ⇒ 0, clamps", () => {
    expect(cast(2.5, "uint8")).toBe(3n);
    expect(cast(-2.5, "int8")).toBe(-3n);
    expect(cast(Number.NaN, "int32")).toBe(0n);
    expect(cast(300.4, "uint8")).toBe(255n);
    expect(cast(-1, "uint8")).toBe(0n);
    expect(roundHalfAway(0.49999999999999994)).toBe(0);
    expect(fromJson("18446744073709551615", "uint64")).toBe(18446744073709551615n);
  });
  test("to string a value is formatted with its own static type (IR_SPEC Formatting)", () => {
    const f = { $const: 0.1, type: "float" };
    const ctx = { ref: () => null, signal: () => undefined, state: () => null, now: () => 0, typeOfRef: () => undefined };
    expect(evaluate({ $expr: { op: "type.cast", value: f, to: "string", type: "string" } }, ctx)).toBe("0.1");
    expect(evaluate({ $expr: { op: "json.string", value: f, type: "string" } }, ctx)).toBe('"0.1"');
    expect(evaluate({ $expr: { op: "json.string", value: { $const: 'say "hi"\n', type: "string" }, type: "string" } }, ctx)).toBe('"say \\"hi\\"\\n"');
    expect(cast(Math.fround(0.1), "string")).toBe("0.10000000149011612");
  });
});

describe("waiters are resumed once", () => {
  test("a waiter resumed by a nested change (state.set of another run) is not resumed again", () => {
    const src = (b: string) => ({ blockId: b });
    const cond = { $expr: { op: ">", l: { $signal: "s0" }, r: { $const: 10, type: "uint8" }, type: "boolean" } };
    const ir = {
      workflowId: "w",
      signals: [{ id: "s0", path: "Vehicle.Speed", dataType: "float" }],
      topics: [],
      state: [{ id: "v0", name: "x", type: "int32", initial: 0 }],
      triggers: [
        { id: "n1", opcode: "event.app_start", props: {}, outputs: {}, entry: "n2", src: src("b1") },
        { id: "n4", opcode: "event.app_start", props: {}, outputs: {}, entry: "n5", src: src("b4") },
      ],
      nodes: [
        { id: "n2", opcode: "control.wait_until", args: { condition: cond, timeoutMs: 10000 }, next: { ok: "n3", timeout: null }, src: src("b2") },
        { id: "n3", opcode: "state.set", args: { state: "v0", value: { $const: 1, type: "int32" } }, next: { next: null }, src: src("b3") },
        { id: "n5", opcode: "control.wait_until", args: { condition: cond, timeoutMs: 10000 }, next: { ok: "n6", timeout: null }, src: src("b5") },
        { id: "n6", opcode: "control.wait", args: { durationMs: 500 }, next: { next: "n7" }, src: src("b6") },
        { id: "n7", opcode: "comm.log", args: { level: "info", message: { $template: ["done"] } }, next: { next: null }, src: src("b7") },
      ],
    };
    const r = simulate(ir, { until: 3000, initial: { "Vehicle.Speed": 0 }, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 20 }] });
    expect(r.logs).toEqual([{ t: 1500, level: "info", message: "done" }]);
    expect(r.trace.filter((e) => e.node === "n5" && e.ev === "exit")).toHaveLength(1);
  });
});

describe("missing values", () => {
  test("using `previous` of the first value (no baseline) is a no_value error, as for a signal without value", async () => {
    const g = structuredClone(gwa);
    g.blocks = g.blocks.filter((b: { id: string }) => ["b1", "b3"].includes(b.id));
    g.blocks[1].props = { path: HAZARD, value: "<speedchanged.previous> > 100", awaitAck: true, onError: "continue" };
    g.edges = [{ id: "e1", from: "b1", fromHandle: "source", to: "b3", toHandle: "target" }];
    const ir = await irOf(g);
    const r = simulate(ir, { until: 2000, inputs: [{ t: 1000, path: "Vehicle.Speed", value: 130 }, { t: 1500, path: "Vehicle.Speed", value: 140 }] });
    expect(r.trace.filter((e) => e.ev === "error").map((e) => [e.ts, e.data])).toEqual([[1000, { reason: "no_value", message: "n1.previous has no value" }]]);
    expect(r.writes).toEqual([{ t: 1500, path: HAZARD, value: true }]);
  });
});

describe("cancelled branches end when cancelled", () => {
  test("parallel join any: the run ends with its last live fiber, so a queued run starts then (analysis/07 §4)", () => {
    const src = (b: string) => ({ blockId: b });
    const ir = {
      workflowId: "w",
      signals: [{ id: "s0", path: "Vehicle.Body.Raindetection.Intensity", dataType: "uint8" }, { id: "s1", path: "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", dataType: "uint8" }],
      topics: [],
      state: [],
      triggers: [{ id: "n1", opcode: "event.signal_changed", signal: "s0", props: { mode: "any", debounceMs: 0 }, concurrency: { policy: "queue", queueMax: 1 }, outputs: { value: { type: "uint8" }, previous: { type: "uint8" }, timestamp: { type: "timestamp" } }, entry: "n2", src: src("b1") }],
      nodes: [
        { id: "n2", opcode: "control.parallel", args: { branches: [{ entry: "n3" }, { entry: "n4" }], join: "any" }, next: { next: "n5" }, src: src("b2") },
        { id: "n3", opcode: "control.wait", args: { durationMs: 100 }, next: { next: null }, src: src("b3") },
        { id: "n4", opcode: "control.wait", args: { durationMs: 300 }, next: { next: "n6" }, src: src("b4") },
        { id: "n6", opcode: "vehicle.write", args: { signal: "s1", value: { $const: 1, type: "uint8" }, awaitAck: true, onError: "continue" }, next: { next: null }, src: src("b6") },
        { id: "n5", opcode: "vehicle.write", args: { signal: "s1", value: { $ref: "n1.value" }, awaitAck: true, onError: "continue" }, next: { next: null }, src: src("b5") },
      ],
    };
    const inputs = [10, 20, 30].map((t, i) => ({ t, path: "Vehicle.Body.Raindetection.Intensity", value: i + 1 }));
    const r = simulate(ir, { until: 2000, initial: { "Vehicle.Body.Raindetection.Intensity": 0 }, inputs });
    // run 1 ends at 110 (branch n4 cancelled, never writes); the queue kept only value 3.
    expect(r.writes.map((w) => [w.t, w.value])).toEqual([[110, 1], [210, 3]]);
    expect(r.trace.filter((e) => e.data?.reason === "queue_overflow")).toHaveLength(1);
  });
});

describe("logic.eval outputs", () => {
  test("a pure block lowered to logic.eval keeps its own output name (array length ⇒ `length`)", () => {
    const src = (b: string) => ({ blockId: b });
    const ir = {
      workflowId: "w",
      signals: [{ id: "s0", path: "Vehicle.Cabin.SeatPosCount", dataType: "uint8[]" }],
      topics: [],
      state: [],
      triggers: [{ id: "n1", opcode: "event.app_start", props: {}, outputs: {}, entry: "n2", src: src("b1") }],
      nodes: [
        { id: "n2", opcode: "control.wait", args: { durationMs: 100 }, next: { next: "n3" }, src: src("b2") },
        { id: "n3", opcode: "logic.eval", args: { value: { $expr: { op: "array.len", value: { $signal: "s0" }, type: "uint32" } } }, outputs: { length: { type: "uint32" } }, next: { next: "n4" }, src: src("b3") },
        { id: "n4", opcode: "comm.log", args: { level: "info", message: { $template: ["seats ", { $ref: "n3.length" }] } }, next: { next: null }, src: src("b4") },
      ],
    };
    const r = simulate(ir, { until: 1000, initial: { "Vehicle.Cabin.SeatPosCount": [2, 3] } });
    expect(r.logs).toEqual([{ t: 100, level: "info", message: "seats 2" }]);
  });
});

describe("state.filter (ADR-0049 §1)", () => {
  test("samples count the window; a value that cannot be computed takes `error` and adds no sample", async () => {
    const LOW = "Vehicle.Body.Lights.Beam.Low.IsOn";
    const block = (id: string, type: string, name: string, props: Record<string, unknown>) => ({ id, type, name, props, parentId: null, blockVersion: 1 });
    const set = (id: string, name: string, path: string, value: unknown) => block(id, "sv_set_actuator", name, { path, value, awaitAck: true, onError: "continue" });
    const graph = {
      graphVersion: "1.0.0",
      workflowId: "filter_samples",
      revision: 1,
      name: "Filter samples",
      vss: { release: "v4.0" },
      variables: [],
      blocks: [
        block("b1", "sv_on_timer", "tick", { intervalMs: 1000, initialDelayMs: 1000, concurrency: "queue" }),
        block("b2", "sv_filter", "avg", { value: "<Vehicle.Speed>", mode: "moving-average", window: 2 }),
        set("b3", "hazard", HAZARD, "<avg.value> == 20 && <avg.samples> == 2"),
        set("b4", "lowBeam", LOW, true),
      ],
      edges: [
        { id: "e1", from: "b1", fromHandle: "source", to: "b2", toHandle: "target" },
        { id: "e2", from: "b2", fromHandle: "source", to: "b3", toHandle: "target" },
        { id: "e3", from: "b2", fromHandle: "error", to: "b4", toHandle: "target" },
      ],
    };
    const r = simulate(await irOf(graph), {
      until: 3500,
      initial: { [HAZARD]: false, [LOW]: false },
      inputs: [
        { t: 1500, path: "Vehicle.Speed", value: 10 },
        { t: 2500, path: "Vehicle.Speed", value: 30 },
      ],
    });
    expect(r.writes).toEqual([
      { t: 1000, path: LOW, value: true },
      { t: 2000, path: HAZARD, value: false },
      { t: 3000, path: HAZARD, value: true },
    ]);
  });
});
