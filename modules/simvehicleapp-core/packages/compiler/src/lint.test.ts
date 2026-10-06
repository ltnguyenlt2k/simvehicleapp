import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { type DiagnosticV1, fixturesDir, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { parseVssRelease, type VssModel } from "@simvehicleapp/vss";
import { BLOCK_SPECS } from "@simvehicleapp/blocks";
import { lint, migrateGraph, type VehicleLookup } from "./index.ts";

const fixture = (rel: string) => `${fixturesDir}${rel}`;
const models: Record<string, VssModel> = {
  "v4.0": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.0.json"), "utf8")), "v4.0"),
  "v4.2": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.2.json"), "utf8")), "v4.2"),
};
let lookups = 0;
const vehicle: VehicleLookup = async (release, paths) => {
  lookups++;
  return new Map(paths.map((p) => [p, models[release]!.nodes.get(p) ?? null]));
};

const corpus = (dir: string) =>
  readdirSync(fixture(dir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [d.name, JSON.parse(readFileSync(fixture(`${dir}/${d.name}/graph.json`), "utf8")) as WorkflowGraphV1] as const);

const errorsOf = (list: DiagnosticV1[]) => list.filter((d) => d.severity === "error");

describe("lint: the shared corpus is clean (M03 gate: golden workflows without lint errors)", () => {
  test.each([...corpus("golden"), ...corpus("conformance")])("%s has no lint errors", async (_id, graph) => {
    const diags = await lint(graph, { vehicle });
    expect(errorsOf(diags)).toEqual([]);
  });
});

/** Minimal valid graph: When Speed changes → Set Hazard = true. */
function base(): WorkflowGraphV1 {
  return structuredClone({
    graphVersion: "1.0.0",
    workflowId: "wf",
    revision: 1,
    name: "t",
    vss: { release: "v4.0" },
    variables: [{ name: "n", type: "int32", initial: 0 }],
    blocks: [
      { id: "b1", type: "sv_on_signal_changed", name: "Speed changed", props: { path: "Vehicle.Speed", mode: "any", debounceMs: 0, concurrency: "restart" }, parentId: null, blockVersion: 1 },
      { id: "b2", type: "sv_set_actuator", name: "Hazard", props: { path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: "<speedchanged.value> > 100", awaitAck: true, onError: "continue" }, parentId: null, blockVersion: 1 },
    ],
    edges: [{ id: "e1", from: "b1", fromHandle: "source", to: "b2", toHandle: "target" }],
  } as unknown as WorkflowGraphV1);
}
const codes = async (g: unknown) => (await lint(g, { vehicle })).map((d) => d.code);

describe("lint: each rule reports its catalog code (\"cố ý sai\", ADR-0016 Verification)", () => {
  test("the base graph is clean", async () => {
    expect(await lint(base(), { vehicle })).toEqual([]);
  });

  test("S0: schema and size", async () => {
    expect(await codes({ graphVersion: "1.0.0" })).toEqual(["GRAPH_SCHEMA_INVALID"]);
    const big = base();
    big.blocks = Array.from({ length: 2001 }, (_, i) => ({ ...base().blocks[0]!, id: `x${i}`, name: `t${i}` }));
    expect(await codes(big)).toEqual(["GRAPH_TOO_LARGE"]);
  });

  test("S1: unknown type, dangling edge, unknown handles, invalid container, names", async () => {
    const g = base();
    g.blocks.push({ id: "b3", type: "sv_teleport", name: "Odd", props: {}, parentId: null });
    g.blocks.push({ id: "b4", type: "sv_log", name: "Log", props: { message: "x" }, parentId: "b2" });
    g.blocks.push({ id: "b5", type: "sv_log", name: "speed changed", props: { message: "y" }, parentId: null });
    g.blocks.push({ id: "b6", type: "sv_log", name: "Vehicle", props: { message: "z" }, parentId: null });
    g.edges.push({ id: "e2", from: "b2", fromHandle: "then", to: "b4", toHandle: "target" });
    g.edges.push({ id: "e3", from: "b2", fromHandle: "source", to: "b1", toHandle: "target" });
    g.edges.push({ id: "e4", from: "b2", fromHandle: "source", to: "nope", toHandle: "target" });
    const c = await codes(g);
    for (const code of ["BLOCK_TYPE_UNKNOWN", "CONTAINER_INVALID", "HANDLE_UNKNOWN", "GRAPH_DANGLING_EDGE", "BLOCK_PROPERTY_INVALID"]) expect(c).toContain(code);
    expect(c.filter((x) => x === "HANDLE_UNKNOWN")).toHaveLength(2);
    expect(c.filter((x) => x === "BLOCK_PROPERTY_INVALID")).toHaveLength(2);
  });

  test("switch case-<i> handles are accepted", async () => {
    const g = base();
    g.blocks.push({ id: "b3", type: "sv_switch", name: "Pick", props: { value: "<speedchanged.value>", cases: [{ when: "1" }] }, parentId: null });
    g.edges.push({ id: "e2", from: "b2", fromHandle: "source", to: "b3", toHandle: "target" }, { id: "e3", from: "b3", fromHandle: "case-0", to: "b2", toHandle: "target" });
    expect(await codes(g)).not.toContain("HANDLE_UNKNOWN");
  });

  test("S2: missing/invalid props, expressions, references, version", async () => {
    const g = base();
    (g.blocks[1]!.props as Record<string, unknown>).value = "";
    g.blocks.push(
      { id: "b3", type: "sv_compare", name: "Cmp", props: { left: "1 +", op: "~", right: "foo(1)" }, parentId: null, blockVersion: 7 },
      { id: "b4", type: "sv_log", name: "Log", props: { message: "Speed <nope.value> and {<variable.missing>}" }, parentId: null },
      { id: "b5", type: "sv_wait", name: "Wait", props: { durationMs: -5 }, parentId: null },
      { id: "b6", type: "sv_while", name: "Loop", props: { condition: "true", maxIterations: null }, parentId: null },
    );
    g.edges.push(
      { id: "e2", from: "b2", fromHandle: "source", to: "b3", toHandle: "target" },
      { id: "e3", from: "b3", fromHandle: "source", to: "b4", toHandle: "target" },
      { id: "e4", from: "b4", fromHandle: "source", to: "b5", toHandle: "target" },
      { id: "e5", from: "b5", fromHandle: "source", to: "b6", toHandle: "target" },
    );
    const diags = await lint(g, { vehicle });
    const byField = (id: string, f: string) => diags.filter((d) => d.blockId === id && d.field === f).map((d) => d.code);
    expect(byField("b2", "value")).toEqual(["BLOCK_PROPERTY_MISSING"]);
    expect(byField("b3", "left")).toEqual(["EXPR_SYNTAX"]);
    expect(byField("b3", "op")).toEqual(["BLOCK_PROPERTY_INVALID"]);
    expect(byField("b3", "right")).toEqual(["EXPR_UNKNOWN_FUNCTION"]);
    expect(diags.filter((d) => d.blockId === "b3" && !d.field).map((d) => d.code)).toEqual(["BLOCK_VERSION_UNSUPPORTED"]);
    expect(byField("b4", "message")).toEqual(["EXPR_UNKNOWN_REF", "EXPR_UNKNOWN_REF"]);
    expect(byField("b5", "durationMs")).toEqual(["BLOCK_PROPERTY_INVALID"]);
    expect(byField("b6", "maxIterations")).toEqual(["LOOP_GUARD_MISSING"]);
    const ref = diags.find((d) => d.code === "EXPR_UNKNOWN_REF" && (d.data as { ref?: string }).ref === "<variable.missing>")!;
    expect(ref.data).toMatchObject({ reason: "unknown_variable" });
  });

  test("S3: path not found, branch, read-only write, wrong kind, enum/range literals, deprecated", async () => {
    const g = base();
    g.blocks.push(
      { id: "b3", type: "sv_read_signal", name: "Nope", props: { path: "Vehicle.Nope" }, parentId: null },
      { id: "b4", type: "sv_read_signal", name: "Cabin", props: { path: "Vehicle.Cabin" }, parentId: null },
      { id: "b5", type: "sv_set_actuator", name: "Set speed", props: { path: "Vehicle.Speed", value: "1" }, parentId: null },
      { id: "b6", type: "sv_read_attribute", name: "Attr", props: { path: "Vehicle.Speed" }, parentId: null },
      { id: "b7", type: "sv_set_actuator", name: "Wipers", props: { path: "Vehicle.Body.Windshield.Front.Wiping.Mode", value: '"TURBO"' }, parentId: null },
      { id: "b8", type: "sv_set_actuator", name: "Window", props: { path: "Vehicle.Cabin.Door.Row1.DriverSide.Window.Position", value: 150 }, parentId: null },
    );
    const diags = await lint(g, { vehicle });
    const code = (id: string) => diags.filter((d) => d.blockId === id && d.code !== "BLOCK_UNREACHABLE").map((d) => d.code);
    expect(code("b3")).toEqual(["VEHICLE_PATH_NOT_FOUND"]);
    expect(code("b4")).toEqual(["VEHICLE_PATH_IS_BRANCH"]);
    expect(code("b5")).toEqual(["VEHICLE_WRITE_READ_ONLY"]);
    expect(code("b6")).toEqual(["BLOCK_PROPERTY_INVALID"]);
    expect(code("b7")).toEqual(["ENUM_VALUE_NOT_ALLOWED"]);
    expect(code("b8")).toEqual(["VALUE_OUT_OF_RANGE"]);

    const v42 = base();
    v42.vss.release = "v4.2";
    v42.blocks.push({ id: "b3", type: "sv_read_attribute", name: "Refuel", props: { path: "Vehicle.Body.RefuelPosition" }, parentId: null });
    v42.edges.push({ id: "e2", from: "b2", fromHandle: "source", to: "b3", toHandle: "target" });
    expect(await codes(v42)).toEqual(["VEHICLE_PATH_DEPRECATED"]);
  });

  test("S6 (part): trigger without action, unreachable, empty parallel, polling hint", async () => {
    const g = base();
    g.blocks.push(
      { id: "b3", type: "sv_on_app_start", name: "Start", props: {}, parentId: null },
      { id: "b4", type: "sv_log", name: "Orphan", props: { message: "x" }, parentId: null },
      { id: "b5", type: "sv_on_timer", name: "Tick", props: { intervalMs: 1000 }, parentId: null },
      { id: "b6", type: "sv_read_signal", name: "Poll", props: { path: "Vehicle.Speed", source: "fresh-read" }, parentId: null },
      { id: "b7", type: "sv_parallel", name: "Par", props: { join: "all" }, parentId: null },
    );
    g.edges.push({ id: "e2", from: "b5", fromHandle: "source", to: "b6", toHandle: "target" }, { id: "e3", from: "b6", fromHandle: "source", to: "b7", toHandle: "target" });
    const diags = await lint(g, { vehicle });
    const pairs = diags.map((d) => `${d.blockId}:${d.code}`);
    expect(pairs).toEqual(expect.arrayContaining(["b3:TRIGGER_WITHOUT_ACTION", "b4:BLOCK_UNREACHABLE", "b7:PARALLEL_BRANCH_EMPTY", "b6:POLLING_PREFER_SUBSCRIPTION"]));
    expect(diags.find((d) => d.code === "POLLING_PREFER_SUBSCRIPTION")!.severity).toBe("info");
  });
});

describe("lint: output contract", () => {
  test("every diagnostic validates against diagnostics.v1 and order is deterministic", async () => {
    const { ContractValidator } = await import("@simvehicleapp/contracts");
    const v = new ContractValidator();
    const g = base();
    g.blocks.push({ id: "b3", type: "sv_log", name: "Orphan", props: { message: "<nope.x>" }, parentId: null });
    const a = await lint(g, { vehicle });
    const b = await lint(structuredClone(g), { vehicle });
    expect(a.length).toBeGreaterThan(0);
    for (const d of a) v.assert("diagnostics", d);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("VSS is looked up once per lint call (batched)", async () => {
    lookups = 0;
    await lint(base(), { vehicle });
    expect(lookups).toBe(1);
  });
});

describe("lint: fan-out and block migrations (M04-T03)", () => {
  test("S1: one output connected to two blocks ⇒ EDGE_FANOUT_NOT_ALLOWED on the source block", async () => {
    const g = base();
    g.blocks.push({ ...structuredClone(g.blocks[1]!), id: "b3", name: "Hazard 2" });
    g.edges.push({ id: "e2", from: "b1", fromHandle: "source", to: "b3", toHandle: "target" });
    const diags = await lint(g, { vehicle });
    const fan = diags.filter((d) => d.code === "EDGE_FANOUT_NOT_ALLOWED");
    expect(fan).toHaveLength(1);
    expect(fan[0]).toMatchObject({ blockId: "b1", severity: "error", stage: "structural", data: { handle: "source", edges: ["e1", "e2"] } });
  });

  test("S1: a parallel container may start several branches (GW-F)", async () => {
    const gwf = JSON.parse(readFileSync(fixture("golden/GW-F/graph.json"), "utf8")) as WorkflowGraphV1;
    expect(gwf.edges.filter((e) => e.fromHandle === "parallel-start-source").length).toBeGreaterThan(1);
    expect((await codes(gwf)).filter((c) => c === "EDGE_FANOUT_NOT_ALLOWED")).toEqual([]);
  });

  const specV2 = () => {
    const specs = BLOCK_SPECS.map((s) => (s.type === "sv_set_actuator" ? { ...s, version: 2 } : s));
    return specs;
  };

  test("S2: an older blockVersion is migrated before it is checked", async () => {
    const g = base();
    // v1 stored the value under `val`; the v2 migration renames it.
    const b2 = g.blocks[1]!;
    (b2 as { props: Record<string, unknown> }).props = { path: "Vehicle.Body.Lights.Hazard.IsSignaling", val: "true" };
    const migrations = { sv_set_actuator: { 1: (p: Readonly<Record<string, unknown>>) => { const { val, ...rest } = p; return { ...rest, value: val }; } } };
    expect(await lint(g, { vehicle, specs: specV2(), migrations })).toEqual([]);
    expect(migrateGraph(g, new Map(specV2().map((s) => [s.type, s])), migrations).graph.blocks[1]).toMatchObject({ blockVersion: 2, props: { value: "true" } });
  });

  test("S2: no migration path, or a newer block ⇒ BLOCK_VERSION_UNSUPPORTED", async () => {
    const g = base();
    const noPath = (await lint(g, { vehicle, specs: specV2(), migrations: {} })).filter((d) => d.code === "BLOCK_VERSION_UNSUPPORTED");
    expect(noPath).toHaveLength(1);
    expect(noPath[0]).toMatchObject({ blockId: "b2", data: { blockVersion: 1, supported: 2, reason: "no_path" } });
    const newer = base();
    newer.blocks[1]!.blockVersion = 3;
    const d = (await lint(newer, { vehicle })).filter((x) => x.code === "BLOCK_VERSION_UNSUPPORTED");
    expect(d[0]).toMatchObject({ blockId: "b2", data: { blockVersion: 3, supported: 1, reason: "newer" } });
  });
});

describe("lint: S3 model hash (M04-T04, risk R2)", () => {
  const pinned = `sha256:${"a".repeat(64)}`;
  const other = `sha256:${"b".repeat(64)}`;
  test("a graph pinned to another model of its release ⇒ MODEL_HASH_MISMATCH (warning)", async () => {
    const g = base();
    g.vss = { release: "v4.0", modelHash: pinned };
    const diags = await lint(g, { vehicle, modelHash: async () => other });
    expect(diags).toEqual([expect.objectContaining({ code: "MODEL_HASH_MISMATCH", severity: "warning", stage: "vehicle-model", data: { release: "v4.0", pinned, current: other } })]);
  });
  test("same hash, no pin, or unknown release ⇒ nothing", async () => {
    const g = base();
    g.vss = { release: "v4.0", modelHash: pinned };
    expect(await lint(g, { vehicle, modelHash: async () => pinned })).toEqual([]);
    expect(await lint(g, { vehicle, modelHash: async () => null })).toEqual([]);
    expect(await lint(base(), { vehicle, modelHash: async () => other })).toEqual([]);
  });
});
