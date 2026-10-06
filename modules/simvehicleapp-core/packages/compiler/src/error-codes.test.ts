import { describe, expect, test } from "bun:test";
import type { BackendCapabilitiesV1, DiagnosticsCatalogV1, WorkflowGraphV1 } from "@simvehicleapp/contracts";
import catalogJson from "@simvehicleapp/contracts/schemas/diagnostics-catalog.v1.json" with { type: "json" };
import { BLOCK_SPECS } from "@simvehicleapp/blocks";
import { type CompileContext, compile } from "./index.ts";
import { fixtureContext } from "./golden-ir.ts";

/**
 * M4 gate (analysis/phases/M04 "Gate", ADR-0016 Verification): every compile-time **error** code of
 * the catalog has a deliberately wrong graph that `compile()` reports with that code on the right
 * block. Stages after compile (codegen/workspace/build/run/license) belong to later milestones.
 */
const COMPILE_STAGES = new Set(["parse", "structural", "block-config", "vehicle-model", "types", "units", "control-flow", "backend"]);
const catalog = catalogJson as DiagnosticsCatalogV1;

type B = WorkflowGraphV1["blocks"][number];
const blk = (id: string, type: string, name: string, props: Record<string, unknown>, parentId: string | null = null) =>
  ({ id, type, name, props, parentId, blockVersion: 1 }) as unknown as B;
const edge = (id: string, from: string, fromHandle: string, to: string, toHandle = "target") => ({ id, from, fromHandle, to, toHandle });
const TRIG = blk("t", "sv_on_signal_changed", "Speed changed", { path: "Vehicle.Speed", mode: "any" });
const SET = (id: string, props: Record<string, unknown>) => blk(id, "sv_set_actuator", `Set ${id}`, { path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: "true", ...props });
function graph(blocks: B[], edges: ReturnType<typeof edge>[], over: Partial<WorkflowGraphV1> = {}): WorkflowGraphV1 {
  return { graphVersion: "1.0.0", workflowId: "wf", revision: 1, name: "Errors", vss: { release: "v4.0" }, variables: [], blocks, edges, ...over } as WorkflowGraphV1;
}
const chain = (...blocks: B[]) => graph([TRIG, ...blocks], blocks.map((b, i) => edge(`e${i}`, i === 0 ? "t" : blocks[i - 1]!.id, "source", b.id)));

const caps = (over: Partial<BackendCapabilitiesV1> = {}): BackendCapabilitiesV1 => ({
  id: "cpp",
  name: "compiler-code-cpp",
  version: "0.1.0",
  language: "cpp",
  irVersions: ">=1.0.0 <2.0.0",
  contracts: ">=1.0.0-alpha.1 <2.0.0",
  opcodes: ["event.signal_changed", "vehicle.write"],
  features: { concurrencyPolicies: ["restart"], trace: true, sourceMaps: true },
  runtime: { name: "rt", version: "0.1.0", vendorPath: "vendor/rt" },
  toolchain: { id: "toolchain-cpp", template: "t", templateSha: "0".repeat(40) },
  ...over,
});

/** [code, graph, blockId expected on the diagnostic (undefined = workflow-level), extra context] */
const CASES: [string, unknown, string | undefined, Partial<CompileContext>?][] = [
  ["GRAPH_SCHEMA_INVALID", { graphVersion: "1.0.0" }, undefined],
  ["GRAPH_TOO_LARGE", graph(Array.from({ length: 2001 }, (_, i) => SET(`x${i}`, {})), []), undefined],
  ["GRAPH_DANGLING_EDGE", graph([TRIG], [edge("e1", "t", "source", "ghost")]), "t"],
  ["BLOCK_TYPE_UNKNOWN", chain(blk("u", "sv_teleport", "Teleport", {})), "u"],
  ["HANDLE_UNKNOWN", graph([TRIG, SET("s", {})], [edge("e1", "t", "then", "s")]), "t"],
  ["CONTAINER_INVALID", graph([TRIG, SET("s", {}), blk("c", "sv_wait", "Child", { durationMs: 1 }, "s")], [edge("e1", "t", "source", "s")]), "c"],
  ["EDGE_FANOUT_NOT_ALLOWED", graph([TRIG, SET("a", {}), SET("b", {})], [edge("e1", "t", "source", "a"), edge("e2", "t", "source", "b")]), "t"],
  ["BLOCK_PROPERTY_MISSING", chain(SET("s", { value: "" })), "s"],
  ["BLOCK_PROPERTY_INVALID", chain(SET("s", { onError: "explode" })), "s"],
  ["EXPR_SYNTAX", chain(SET("s", { value: "1 +" })), "s"],
  ["EXPR_UNKNOWN_REF", chain(SET("s", { value: "<nosuch.value>" })), "s"],
  ["EXPR_UNKNOWN_FUNCTION", chain(SET("s", { value: "launch(1)" })), "s"],
  ["BLOCK_VERSION_UNSUPPORTED", graph([TRIG, { ...SET("s", {}), blockVersion: 9 } as B], [edge("e1", "t", "source", "s")]), "s"],
  ["VEHICLE_PATH_NOT_FOUND", chain(SET("s", { path: "Vehicle.Nope" })), "s"],
  ["VEHICLE_WRITE_READ_ONLY", chain(SET("s", { path: "Vehicle.Speed", value: "1" })), "s"],
  ["VEHICLE_PATH_IS_BRANCH", chain(SET("s", { path: "Vehicle.Body" })), "s"],
  ["ENUM_VALUE_NOT_ALLOWED", chain(SET("s", { path: "Vehicle.Body.Windshield.Front.Wiping.Mode", value: '"TURBO"' })), "s"],
  ["TYPE_MISMATCH", chain(SET("s", { value: '"yes"' })), "s"],
  ["TYPE_NARROWING_REQUIRES_CAST", chain(SET("s", { path: "Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", value: "scale(<speedchanged.value>, 0, 200, 0, 100)" })), "s"],
  ["UNIT_DIMENSION_MISMATCH", chain(SET("s", { value: "<speedchanged.value> > 3 s" })), "s"],
  ["ARRAY_VALUE_REQUIRES_INDEXING", chain(blk("r", "sv_read_attribute", "Pids", { path: "Vehicle.OBD.PidsA" }), SET("s", { value: "<pids.value> == 1" })), "s"],
  ["ARRAY_INDEX_TYPE_INVALID", chain(blk("r", "sv_read_attribute", "Pids", { path: "Vehicle.OBD.PidsA" }), SET("s", { value: "<pids.value>[0.5] == 1" })), "s"],
  ["ARRAY_ELEMENT_TYPE_MISMATCH", chain(blk("r", "sv_read_attribute", "Pids", { path: "Vehicle.OBD.PidsA" }), SET("s", { value: "contains(<pids.value>, 1)" })), "s"],
  ["CONTROL_FLOW_CYCLE", graph([TRIG, SET("a", {}), SET("b", {})], [edge("e1", "t", "source", "a"), edge("e2", "a", "source", "b"), edge("e3", "b", "source", "a")]), "a"],
  ["DATA_REF_NOT_DOMINATING", graph(
    [TRIG, blk("i", "sv_if", "Check", { condition: "true" }), blk("x", "sv_expression", "Fast", { expr: "1" }), SET("s", { value: "<fast.result> == 1" })],
    [edge("e1", "t", "source", "i"), edge("e2", "i", "then", "x"), edge("e3", "i", "else", "s")],
  ), "s"],
  ["LOOP_GUARD_MISSING", graph(
    [TRIG, blk("w", "sv_while", "Loop", { condition: "true", maxIterations: null }), SET("s", {}, )],
    [edge("e1", "t", "source", "w"), edge("e2", "w", "loop-start-source", "s")],
  ), "w"],
  ["PARALLEL_BRANCH_EMPTY", chain(blk("p", "sv_parallel", "Both", { join: "all" })), "p"],
  ["OPCODE_UNSUPPORTED_BY_BACKEND", chain(blk("w", "sv_wait", "Pause", { durationMs: 10 })), "w", { backend: "cpp", capabilities: async () => caps() }],
  ["IR_VERSION_UNSUPPORTED", chain(SET("s", {})), undefined, { backend: "cpp", capabilities: async () => caps({ irVersions: ">=2.0.0" }) }],
  ["BACKEND_UNAVAILABLE", chain(SET("s", {})), undefined, { backend: "cobol", capabilities: async () => null }],
];
// Children of containers sit inside them (the LOOP_GUARD_MISSING child): fix parentId after building.
(CASES.find((c) => c[0] === "LOOP_GUARD_MISSING")![1] as WorkflowGraphV1).blocks[2]!.parentId = "w";

describe("every compile-time error code has a deliberately wrong graph (M4 gate)", () => {
  for (const [code, g, blockId, extra] of CASES) {
    test(`${code}${blockId ? ` on ${blockId}` : ""}`, async () => {
      const r = await compile(g, { ...fixtureContext(), ...extra });
      const hits = r.diagnostics.filter((d) => d.code === code);
      expect(hits.length, JSON.stringify(r.diagnostics.map((d) => d.code))).toBeGreaterThan(0);
      expect(hits[0]!.severity).toBe("error");
      expect(hits[0]!.blockId).toBe(blockId);
      expect(r.ir).toBeUndefined();
    });
  }

  test("the table covers every compile-time error code of the catalog", () => {
    const required = catalog.codes.filter((c) => c.severity === "error" && COMPILE_STAGES.has(c.stage) && !c.deprecated).map((c) => c.code).sort();
    expect(CASES.map((c) => c[0]).sort()).toEqual(required);
  });

  test("the specs used here exist (guards against renamed block types)", () => {
    const types = new Set(BLOCK_SPECS.map((s) => s.type));
    for (const t of ["sv_on_signal_changed", "sv_set_actuator", "sv_read_attribute", "sv_if", "sv_expression", "sv_while", "sv_parallel", "sv_wait"]) expect(types.has(t)).toBe(true);
  });
});
