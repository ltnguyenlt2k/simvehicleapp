import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { parseVssRelease } from "@simvehicleapp/vss";
import { type CompileContext, compile, lint } from "./index.ts";

const v40 = parseVssRelease(JSON.parse(readFileSync(`${fixturesDir}vss/vss_rel_4.0.json`, "utf8")), "v4.0");
const ctx: CompileContext = {
  vehicle: async (_release, paths) => new Map(paths.map((p) => [p, v40.nodes.get(p) ?? null])),
  modelHash: async () => v40.modelHash,
};

/** ADR-0063: a workflow calls a function workflow; the call is inlined before lint. */
const block = (id: string, type: string, name: string, props: Record<string, unknown>) => ({ id, type, name, props, parentId: null, blockVersion: 1 });
const edge = (id: string, from: string, fromHandle: string, to: string) => ({ id, from, fromHandle, to, toHandle: "target" });
const graph = (workflowId: string, name: string, blocks: unknown[], edges: unknown[], variables: unknown[] = []) => ({
  graphVersion: "1.0.0",
  workflowId,
  revision: 1,
  name,
  vss: { release: "v4.0" },
  variables,
  blocks,
  edges,
});

const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";
/** Function workflow: result = speed > 120. */
const safety = graph(
  "fn_safety",
  "Safety check",
  [
    block("f1", "sv_on_call", "called", {}),
    block("f2", "sv_var_get", "spd", { name: "speed" }),
    block("f3", "sv_if", "fast", { condition: "<spd.value> > 120" }),
    block("f4", "sv_var_set", "yes", { name: "result", value: "true" }),
    block("f5", "sv_var_set", "no", { name: "result", value: "false" }),
  ],
  [edge("g1", "f1", "source", "f2"), edge("g2", "f2", "source", "f3"), edge("g3", "f3", "then", "f4"), edge("g4", "f3", "else", "f5")],
  [
    { name: "speed", type: "double", initial: 0 },
    { name: "result", type: "boolean", initial: false },
  ],
);
const caller = (callProps: Record<string, unknown>) =>
  graph(
    "caller",
    "Hazard on overspeed",
    [
      block("b1", "sv_on_signal_changed", "trig", { path: "Vehicle.Speed", mode: "any", debounceMs: 0, concurrency: "restart" }),
      block("b2", "sv_call_workflow", "check", { workflowId: "fn_safety", args: [{ name: "speed", value: "<trig.value>" }], ...callProps }),
      block("b3", "sv_set_actuator", "set3", { path: HAZARD, value: "<check.value>", awaitAck: true, onError: "continue" }),
    ],
    [edge("e1", "b1", "source", "b2"), edge("e2", "b2", "source", "b3")],
  );

describe("sub-workflows (ADR-0063)", () => {
  test("the call is inlined: args set, the body runs, <call.value> is the function's result; same input ⇒ same IR", async () => {
    const r = await compile(caller({}), { ...ctx, callees: [safety] });
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(new ContractValidator().validate("ir", r.ir).errors).toEqual([]);
    const text = JSON.stringify(r.ir);
    expect(text).toContain("check__speed");
    expect(text).toContain("check__result");
    expect(text).toContain("state.set");
    expect(text).toContain("control.branch");
    const again = await compile(structuredClone(caller({})), { ...ctx, callees: [structuredClone(safety)] });
    expect(JSON.stringify(again.ir)).toBe(text);
  });

  test("a change in the function changes the IR's source hash", async () => {
    const a = await compile(caller({}), { ...ctx, callees: [safety] });
    const changed = structuredClone(safety);
    (changed.blocks[2] as { props: Record<string, unknown> }).props.condition = "<spd.value> > 100";
    const b = await compile(caller({}), { ...ctx, callees: [changed] });
    expect((a.ir as { sourceGraphHash: string }).sourceGraphHash).not.toBe((b.ir as { sourceGraphHash: string }).sourceGraphHash);
  });

  test("no such function, an unknown argument, a loop, a function compiled on its own", async () => {
    const notFound = await compile(caller({ workflowId: "nope" }), { ...ctx, callees: [safety] });
    expect(notFound.diagnostics.map((d) => [d.code, d.blockId])).toEqual([["SUBWORKFLOW_NOT_FOUND", "b2"]]);
    const badArg = await compile(caller({ args: [{ name: "spede", value: "1" }] }), { ...ctx, callees: [safety] });
    expect(badArg.diagnostics.map((d) => [d.code, d.blockId, d.field])).toEqual([["SUBWORKFLOW_ARG_UNKNOWN", "b2", "args"]]);
    const loop = graph("fn_loop", "Loop", [block("l1", "sv_on_call", "called", {}), block("l2", "sv_call_workflow", "again", { workflowId: "fn_loop" })], [edge("m1", "l1", "source", "l2")]);
    const r = await compile(caller({ workflowId: "fn_loop", args: [] }), { ...ctx, callees: [loop] });
    expect(r.diagnostics.map((d) => [d.code, d.blockId])).toEqual([["SUBWORKFLOW_RECURSIVE", "b2"]]);
    expect(r.diagnostics[0]!.message).toContain("In Loop:");
    // A function workflow on its own: a warning, its body linted like any workflow, no IR.
    const alone = await compile(safety, ctx);
    expect(alone.diagnostics.map((d) => [d.code, d.severity, d.blockId])).toEqual([["SUBWORKFLOW_ONLY_CALLED", "warning", "f1"]]);
    expect(alone.ir).toBeUndefined();
    const broken = structuredClone(safety);
    (broken.blocks[2] as { props: Record<string, unknown> }).props.condition = "<nothere.value> > 120";
    const linted = await lint(broken, ctx);
    expect(linted.filter((d) => d.severity === "error").map((d) => [d.code, d.blockId])).toEqual([["EXPR_UNKNOWN_REF", "f3"]]);
  });

  test("calls nest up to 4 levels", async () => {
    const level = (i: number, next?: string) =>
      graph(`fn_${i}`, `Level ${i}`, [block("n1", "sv_on_call", "called", {}), ...(next ? [block("n2", "sv_call_workflow", `call${i}`, { workflowId: next })] : [])], next ? [edge("k1", "n1", "source", "n2")] : []);
    const chain = (n: number) => Array.from({ length: n }, (_, i) => level(i + 1, i + 1 < n ? `fn_${i + 2}` : undefined));
    const top = (n: number) => compile(caller({ workflowId: "fn_1", args: [] }), { ...ctx, callees: chain(n) });
    // <check.value> has no `result` to read: the depth is the only problem we look at here.
    expect((await top(4)).diagnostics.some((d) => d.code.startsWith("SUBWORKFLOW_"))).toBe(false);
    expect((await top(5)).diagnostics.map((d) => d.code)).toContain("SUBWORKFLOW_TOO_DEEP");
  });

  test("a mistake inside the function is reported on the call, with the function's name", async () => {
    const broken = structuredClone(safety);
    (broken.blocks[2] as { props: Record<string, unknown> }).props.condition = "<nothere.value> > 120";
    const r = await compile(caller({}), { ...ctx, callees: [broken] });
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const d of errors) {
      expect(d.blockId).toBe("b2");
      expect(d.message.startsWith("In Safety check:")).toBe(true);
    }
  });
});

describe("sub-workflow diagnostics land on the call the user sees (ADR-0063)", () => {
  test("a call not connected to a trigger: one BLOCK_UNREACHABLE, on the call, by its name", async () => {
    const g = caller({});
    g.edges = (g.edges as { id: string }[]).filter((e) => e.id !== "e1");
    const r = await compile(g, { ...ctx, callees: [safety] });
    const unreachable = r.diagnostics.filter((d) => d.code === "BLOCK_UNREACHABLE");
    expect(unreachable.filter((d) => d.blockId === "b2").map((d) => d.message)).toEqual(["check never runs — it is not connected to a trigger"]);
    expect(unreachable.every((d) => ["b2", "b3"].includes(d.blockId ?? ""))).toBe(true);
  });

  test("a mistake two calls deep is reported on the outer call, with the chain of functions", async () => {
    const inner = structuredClone(safety);
    inner.workflowId = "fn_inner";
    inner.name = "Inner check";
    (inner.blocks[2] as { props: Record<string, unknown> }).props.condition = "<nothere.value> > 120";
    const outer = graph("fn_safety", "Safety check", [block("o1", "sv_on_call", "called", {}), block("o2", "sv_call_workflow", "deeper", { workflowId: "fn_inner", args: [] })], [edge("p1", "o1", "source", "o2")], [
      { name: "speed", type: "double", initial: 0 },
      { name: "result", type: "boolean", initial: false },
    ]);
    const r = await compile(caller({}), { ...ctx, callees: [outer, inner] });
    const errors = r.diagnostics.filter((d) => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
    for (const d of errors) {
      expect(d.blockId).toBe("b2");
      expect(d.message).toContain("Inner check");
    }
  });
});
