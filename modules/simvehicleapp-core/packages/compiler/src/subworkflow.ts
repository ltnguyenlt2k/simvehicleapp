import type { BlockSpec } from "@simvehicleapp/blocks";
import type { DiagnosticV1 } from "@simvehicleapp/contracts";
import { diag as catalogDiag } from "./diagnostics.ts";
import { normalizeName } from "./lint.ts";

/**
 * Sub-workflows (ADR-0063): a `sv_call_workflow` block is replaced, before lint, by the body of the function workflow it
 * calls — its arguments set as the function's (renamed) variables, then the body, then a `sv_var_get` named like the call
 * block that reads the function's `result`. Lint, typing, IR, simulator and code generation then see one flat graph.
 */

type Props = Record<string, unknown>;
interface Block {
  id: string;
  type: string;
  name: string;
  props: Props;
  parentId?: string | null;
  blockVersion?: number;
  [k: string]: unknown;
}
interface Edge {
  id: string;
  from: string;
  fromHandle: string;
  to: string;
  toHandle: string;
}
interface Variable {
  name: string;
  type: string;
  initial: unknown;
}
export interface FlowGraph {
  workflowId: string;
  name: string;
  variables?: Variable[];
  blocks: Block[];
  edges: Edge[];
  [k: string]: unknown;
}

export const CALL = "sv_call_workflow";
export const ON_CALL = "sv_on_call";
export const MAX_CALL_DEPTH = 4;
/** Blocks whose `name` prop is a workflow variable (lint `VARIABLE_BLOCKS`). */
const VARIABLE_BLOCKS = new Set(["sv_var_get", "sv_var_set", "sv_counter", "sv_state_machine"]);
const REF = /<([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)+)>/g;

/** Where an inlined block comes from: the call of the compiled graph, its name, and the function chain. */
interface Origin {
  call: string;
  callName: string;
  workflow: string;
}

export interface Expanded {
  graph: FlowGraph;
  diagnostics: DiagnosticV1[];
  /** Inlined block id ⇒ the call block of the graph that was compiled, and the function's name (diagnostics). */
  origin: Map<string, Origin>;
}


/** Expands every call of `graph`; `callees` are the function workflows it may call (directly or not). */
export function expandCalls(graph: FlowGraph, callees: readonly FlowGraph[], specs: Map<string, BlockSpec>): Expanded {
  const diagnostics: DiagnosticV1[] = [];
  const origin = new Map<string, Origin>();
  const byId = new Map(callees.map((w) => [w.workflowId, w]));
  const diag = (code: string, blockId: string, message: string, data: Record<string, unknown> = {}, field = "workflowId") =>
    catalogDiag(code, graph.workflowId, { blockId, field, message, data });
  const flat = expand(graph, [graph.workflowId], 0, byId, specs, diagnostics, origin, diag);
  return { graph: flat, diagnostics, origin };
}

function expand(
  g: FlowGraph,
  stack: string[],
  depth: number,
  callees: Map<string, FlowGraph>,
  specs: Map<string, BlockSpec>,
  diagnostics: DiagnosticV1[],
  origin: Map<string, Origin>,
  diag: (code: string, blockId: string, message: string, data?: Record<string, unknown>, field?: string) => DiagnosticV1,
): FlowGraph {
  if (!g.blocks.some((b) => b.type === CALL)) return g;
  let blocks = [...g.blocks];
  let edges = [...g.edges];
  const variables = [...(g.variables ?? [])];
  for (const call of g.blocks.filter((b) => b.type === CALL)) {
    const fid = String(call.props.workflowId ?? "");
    const fn = callees.get(fid);
    const entries = fn?.blocks.filter((b) => b.type === ON_CALL) ?? [];
    if (!fn || entries.length !== 1) {
      diagnostics.push(diag("SUBWORKFLOW_NOT_FOUND", call.id, fn ? `${fn.name} is not a function workflow: it needs exactly one "When called" trigger` : `The workflow this block calls (${fid || "none"}) is not available`, { workflowId: fid }));
      continue;
    }
    if (stack.includes(fid)) {
      diagnostics.push(diag("SUBWORKFLOW_RECURSIVE", call.id, `${fn.name} calls itself (${[...stack, fid].join(" → ")}): calls must not loop`, { workflowId: fid, chain: [...stack, fid] }));
      continue;
    }
    if (depth >= MAX_CALL_DEPTH) {
      diagnostics.push(diag("SUBWORKFLOW_TOO_DEEP", call.id, `Calls are nested more than ${MAX_CALL_DEPTH} levels deep`, { workflowId: fid, max: MAX_CALL_DEPTH }));
      continue;
    }
    const nested: DiagnosticV1[] = [];
    const nestedOrigin = new Map<string, Origin>();
    const body = expand(fn, [...stack, fid], depth + 1, callees, specs, nested, nestedOrigin, diag);
    // A problem inside the function is reported on the call that brought it in.
    for (const d of nested) diagnostics.push({ ...d, blockId: call.id, message: `In ${fn.name}: ${d.message}` });
    if (nested.some((d) => d.severity === "error")) continue;

    const fnVars = new Map((body.variables ?? []).map((v) => [v.name, v]));
    // `args` is a list of {name, value} (BlockSpec kind list): later entries for the same name win.
    const args: Record<string, unknown> = {};
    for (const a of Array.isArray(call.props.args) ? (call.props.args as { name?: unknown; value?: unknown }[]) : []) if (typeof a?.name === "string" && a.name) args[a.name] = a.value;
    const unknown = Object.keys(args).filter((a) => !fnVars.has(a)).sort();
    if (unknown.length) {
      diagnostics.push(diag("SUBWORKFLOW_ARG_UNKNOWN", call.id, `${fn.name} has no variable ${unknown.join(", ")}`, { workflowId: fid, args: unknown }, "args"));
      continue;
    }

    const varName = (v: string) => `${call.name.replace(/[^A-Za-z0-9_]/g, "_")}__${v}`.slice(0, 64);
    const entry = entries[0]!;
    const inner = body.blocks.filter((b) => b.id !== entry.id);
    const newId = (id: string) => `${call.id}-${id}`.slice(0, 128);
    const names = new Map(inner.map((b) => [normalizeName(b.name), normalizeName(`${call.name}_${b.name}`)]));
    const rename = (v: unknown): unknown => {
      if (typeof v === "string") return v.replace(REF, (m, head: string, rest: string) => (names.has(normalizeName(head)) ? `<${names.get(normalizeName(head))}${rest}>` : m));
      if (Array.isArray(v)) return v.map(rename);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rename(x)]));
      return v;
    };
    const copied: Block[] = inner.map((b) => {
      const props = rename(b.props) as Props;
      if (VARIABLE_BLOCKS.has(b.type) && typeof props.name === "string" && fnVars.has(props.name)) props.name = varName(props.name);
      const c: Block = { ...b, id: newId(b.id), name: `${call.name}_${b.name}`, props, parentId: b.parentId ? newId(b.parentId) : (b.parentId ?? null) };
      // Blocks of a nested call belong to this call too (the nested call is not a block of the compiled graph).
      const inner = nestedOrigin.get(b.id);
      origin.set(c.id, { call: call.id, callName: call.name, workflow: inner ? `${fn.name} › ${inner.workflow}` : fn.name });
      return c;
    });
    for (const v of body.variables ?? []) variables.push({ ...v, name: varName(v.name) });

    // Arguments, in the order the call lists them; then the body; then the result.
    const argBlocks: Block[] = Object.keys(args).map((a) => ({ id: newId(`arg-${a}`), type: "sv_var_set", name: `${call.name}_arg_${a}`, props: { name: varName(a), value: args[a] }, parentId: call.parentId ?? null, blockVersion: 1 }));
    const result: Block | null = fnVars.has("result") ? { id: newId("result"), type: "sv_var_get", name: call.name, props: { name: varName("result") }, parentId: call.parentId ?? null, blockVersion: 1 } : null;
    for (const b of [...argBlocks, ...(result ? [result] : [])]) origin.set(b.id, { call: call.id, callName: call.name, workflow: fn.name });

    let n = 0;
    const edge = (from: string, fromHandle: string, to: string, toHandle = "target"): Edge => ({ id: newId(`e${n++}`), from, fromHandle, to, toHandle });
    const after = edges.filter((e) => e.from === call.id && e.fromHandle === "source");
    const continuation = (from: string, fromHandle: string): Edge[] => (result ? [edge(from, fromHandle, result.id)] : after.map((e) => edge(from, fromHandle, e.to, e.toHandle)));
    const bodyEdges = body.edges.filter((e) => e.from !== entry.id).map((e) => ({ ...e, id: newId(e.id), from: newId(e.from), to: newId(e.to) }));
    const starts = body.edges.filter((e) => e.from === entry.id).map((e) => ({ to: newId(e.to), toHandle: e.toHandle }));
    // Every handle of a top-level body block left open (but `error`) ends the call.
    const ends: Edge[] = [];
    for (const b of inner.filter((x) => !x.parentId)) {
      for (const h of specs.get(b.type)?.handles.out ?? []) {
        if (h === "error" || body.edges.some((e) => e.from === b.id && e.fromHandle === h)) continue;
        ends.push(...continuation(newId(b.id), h));
      }
    }
    const into: { to: string; toHandle: string }[] = [];
    const link = (from: string, fromHandle: string, targets: { to: string; toHandle: string }[]) => targets.map((t) => edge(from, fromHandle, t.to, t.toHandle));
    const wiring: Edge[] = [];
    if (argBlocks.length) {
      into.push({ to: argBlocks[0]!.id, toHandle: "target" });
      for (let i = 1; i < argBlocks.length; i++) wiring.push(edge(argBlocks[i - 1]!.id, "source", argBlocks[i]!.id));
      const last = argBlocks.at(-1)!.id;
      wiring.push(...(starts.length ? link(last, "source", starts) : continuation(last, "source")));
    } else if (starts.length) into.push(...starts);
    else if (result) into.push({ to: result.id, toHandle: "target" });
    else into.push(...after.map((e) => ({ to: e.to, toHandle: e.toHandle })));
    if (result) wiring.push(...after.map((e) => edge(result.id, "source", e.to, e.toHandle)));

    const incoming = edges.filter((e) => e.to === call.id);
    edges = [
      ...edges.filter((e) => e.to !== call.id && e.from !== call.id),
      ...incoming.flatMap((e) => into.map((t, k) => ({ ...e, id: k ? `${e.id}-${k}` : e.id, to: t.to, toHandle: t.toHandle }))),
      ...wiring,
      ...bodyEdges,
      ...ends,
    ];
    const at = blocks.findIndex((b) => b.id === call.id);
    blocks = [...blocks.slice(0, at), ...argBlocks, ...copied, ...(result ? [result] : []), ...blocks.slice(at + 1)];
  }
  return { ...g, variables, blocks, edges };
}

export interface PreparedCalls {
  /** The graph to lint and compile: calls inlined (or the input itself when it has none). */
  graph: unknown;
  /** Problems of the calls themselves; any error means no IR. */
  diagnostics: DiagnosticV1[];
  /** Reports the diagnostics of inlined blocks on the call that brought them in, once each. */
  adopt(list: DiagnosticV1[]): DiagnosticV1[];
  /** A function workflow compiled on its own: linted like any workflow, but it builds no IR (no trigger of its own). */
  functionOnly?: boolean;
}

/** ADR-0063 before lint: inline the calls of `input`, or refuse a function workflow compiled on its own. */
export function prepareCalls(input: unknown, callees: readonly unknown[] | undefined, specs: Map<string, BlockSpec>): PreparedCalls {
  const g = input as FlowGraph | null;
  const none: PreparedCalls = { graph: input, diagnostics: [], adopt: (list) => list };
  if (!g || typeof g !== "object" || !Array.isArray(g.blocks) || !Array.isArray(g.edges)) return none;
  const entry = g.blocks.find((b) => b?.type === ON_CALL);
  if (entry) {
    const message = `${g.name ?? "This workflow"} is a function workflow: it runs only when another workflow calls it ("Call workflow")`;
    return { ...none, functionOnly: true, diagnostics: [catalogDiag("SUBWORKFLOW_ONLY_CALLED", String(g.workflowId ?? ""), { blockId: entry.id, message })] };
  }
  if (!g.blocks.some((b) => b?.type === CALL)) return none;
  const ex = expandCalls(g, (callees ?? []) as FlowGraph[], specs);
  return {
    graph: ex.graph,
    diagnostics: ex.diagnostics,
    adopt: (list) => {
      const seen = new Set<string>();
      const out: DiagnosticV1[] = [];
      for (const d of list) {
        const o = d.blockId ? ex.origin.get(d.blockId) : undefined;
        // An unconnected call leaves every inlined block unreachable: one warning, on the call, says it.
        const r = !o
          ? d
          : d.code === "BLOCK_UNREACHABLE"
            ? { ...d, blockId: o.call, message: `${o.callName} never runs — it is not connected to a trigger` }
            : { ...d, blockId: o.call, message: `In ${o.workflow}: ${d.message}` };
        const key = `${r.code}|${r.blockId ?? ""}|${r.field ?? ""}|${r.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(r);
      }
      return out;
    },
  };
}
