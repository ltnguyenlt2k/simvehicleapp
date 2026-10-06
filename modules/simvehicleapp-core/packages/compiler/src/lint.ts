import { ContractValidator, type DiagnosticV1, type GraphBlock, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { BLOCK_SPECS, type BlockSpec } from "@simvehicleapp/blocks";
import { checkRefs, collectRefs, type Node, parseExpression, type RefResolver } from "@simvehicleapp/expr";
import { isArrayType, type VssNode } from "@simvehicleapp/vss";
import { diag, sortDiagnostics } from "./diagnostics.ts";
import { MIGRATIONS, migrateGraph, type MigrationRegistry } from "./migrations.ts";

/** analysis/06 §3 S0. */
export const MAX_BLOCKS = 2000;
export const MAX_GRAPH_BYTES = 1024 * 1024;

/**
 * VSS lookup for the graph's release (ADR-0010 §1: the compiler never parses VSS itself). `null` =
 * path not in the release. Implemented over `vss-catalog /nodes` by the compiler service.
 */
export type VehicleLookup = (release: string, paths: readonly string[]) => Promise<ReadonlyMap<string, VssNode | null>>;

/** sha256 of the catalog's model for a release (vss-catalog `/model-hash`); `null` = unknown release. */
export type ModelHashLookup = (release: string) => Promise<string | null>;

export interface LintContext {
  vehicle: VehicleLookup;
  /** When set, a graph pinned to another model hash gets MODEL_HASH_MISMATCH (risk R2). */
  modelHash?: ModelHashLookup;
  specs?: readonly BlockSpec[];
  /** Block property migrations (defaults to the built-in registry). */
  migrations?: MigrationRegistry;
}

const CONTAINERS = new Set(["sv_repeat", "sv_while", "sv_parallel"]);
const PARALLEL_START = "parallel-start-source";
const TRIGGER_CATEGORY = "triggers";
const validator = new ContractValidator();

/** Sim `normalizeName` (ADR-0013 Notes): lowercase, no whitespace, no dots. */
export const normalizeName = (name: string) => name.toLowerCase().replace(/\s+/g, "").replace(/\./g, "");

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** Inline `<ref>`s of a template prop: plain text, braces are literal (ADR-0013 Notes M03-T11). */
const INLINE_REF = /<([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)>/g;

/** The single literal of a parsed expression, if it is one (`true`, `42`, `"RAIN_SENSOR"`). */
function literalOf(value: unknown): { value: unknown } | undefined {
  if (typeof value !== "string") return value === undefined || value === null ? undefined : { value };
  const r = parseExpression(value);
  if (!r.ok) return undefined;
  const n = r.ast;
  if (n.type === "bool") return { value: n.value };
  if (n.type === "string") return { value: n.value };
  if (n.type === "number" && !n.unit) return { value: Number(n.raw) };
  if (n.type === "unary" && n.op === "-" && n.arg.type === "number" && !n.arg.unit) return { value: -Number(n.arg.raw) };
  return undefined;
}

/**
 * Realtime lint of a WorkflowGraph (analysis/05 §4, 06 §3: S0–S3 + part of S6). Pure apart from the
 * injected VSS lookup; diagnostics are deterministic and use only catalog codes (ADR-0016).
 */
export async function lint(graphInput: unknown, ctx: LintContext): Promise<DiagnosticV1[]> {
  const out: DiagnosticV1[] = [];
  const wfId =
    typeof graphInput === "object" && graphInput && typeof (graphInput as { workflowId?: unknown }).workflowId === "string"
      ? (graphInput as { workflowId: string }).workflowId
      : "unknown";

  // S0 — parse & limits
  const bytes = new TextEncoder().encode(JSON.stringify(graphInput ?? null)).length;
  const blockCount = Array.isArray((graphInput as { blocks?: unknown })?.blocks) ? (graphInput as { blocks: unknown[] }).blocks.length : 0;
  if (bytes > MAX_GRAPH_BYTES || blockCount > MAX_BLOCKS) {
    return [diag("GRAPH_TOO_LARGE", wfId, { message: `Workflow is too large (${blockCount} blocks, ${bytes} bytes; max ${MAX_BLOCKS} blocks, 1 MB)`, data: { blocks: blockCount, bytes } })];
  }
  const schema = validator.validate("workflow-graph", graphInput);
  if (!schema.valid) {
    return [
      diag("GRAPH_SCHEMA_INVALID", wfId, {
        message: "Workflow graph does not match the WorkflowGraph contract",
        data: { errors: schema.errors.slice(0, 10).map((e) => `${e.instancePath || "/"} ${e.message}`) },
      }),
    ];
  }
  const specs = new Map((ctx.specs ?? BLOCK_SPECS).map((s) => [s.type, s]));
  // S2 (first): old blockVersions are migrated so every later check sees current props.
  const { graph, failures: migrationFailures } = migrateGraph(graphInput as WorkflowGraphV1, specs, ctx.migrations ?? MIGRATIONS);
  for (const f of migrationFailures) {
    const title = specs.get(f.type)!.title;
    out.push(
      diag("BLOCK_VERSION_UNSUPPORTED", wfId, {
        blockId: f.blockId,
        message: f.reason === "newer" ? `${title} v${f.from} is newer than this compiler (v${f.to})` : `${title} v${f.from} cannot be upgraded to v${f.to}`,
        data: { blockVersion: f.from, supported: f.to, reason: f.reason },
      }),
    );
  }
  const byId = new Map(graph.blocks.map((b) => [b.id, b]));
  const byName = new Map(graph.blocks.map((b) => [normalizeName(b.name), b]));
  const known = graph.blocks.filter((b) => specs.has(b.type));

  // S1 — structural
  for (const b of graph.blocks) {
    if (!specs.has(b.type)) out.push(diag("BLOCK_TYPE_UNKNOWN", wfId, { blockId: b.id, message: `Unknown block type ${b.type}`, data: { type: b.type } }));
    if (b.parentId && !CONTAINERS.has(byId.get(b.parentId)?.type ?? "")) {
      out.push(diag("CONTAINER_INVALID", wfId, { blockId: b.id, message: "Block sits inside something that is not a repeat/while/parallel container", data: { parentId: b.parentId } }));
    }
  }
  const seenNames = new Map<string, string>();
  for (const b of graph.blocks) {
    const n = normalizeName(b.name);
    if (n === "vehicle") {
      out.push(diag("BLOCK_PROPERTY_INVALID", wfId, { blockId: b.id, field: "name", message: "'Vehicle' is reserved for VSS signals; rename the block", data: { reason: "reserved_name" } }));
    } else if (seenNames.has(n)) {
      out.push(diag("BLOCK_PROPERTY_INVALID", wfId, { blockId: b.id, field: "name", message: `Another block already uses the name '${b.name}' (references would be ambiguous)`, data: { reason: "duplicate_name", other: seenNames.get(n) } }));
    } else seenNames.set(n, b.id);
  }
  for (const e of graph.edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) {
      out.push(diag("GRAPH_DANGLING_EDGE", wfId, { blockId: from?.id ?? to?.id, message: `Connection ${e.id} points at a missing block`, data: { edge: e.id } }));
      continue;
    }
    const fs = specs.get(from.type);
    const ts = specs.get(to.type);
    const outOk = !fs || fs.handles.out.includes(e.fromHandle) || (fs.handles.out.includes("case") && /^case-\d+$/.test(e.fromHandle));
    if (!outOk) out.push(diag("HANDLE_UNKNOWN", wfId, { blockId: from.id, message: `${fs!.title} has no output '${e.fromHandle}'`, data: { edge: e.id, handle: e.fromHandle } }));
    if (ts && !ts.handles.in.includes(e.toHandle)) {
      out.push(diag("HANDLE_UNKNOWN", wfId, { blockId: to.id, message: `${ts.title} cannot be entered through '${e.toHandle}'`, data: { edge: e.id, handle: e.toHandle } }));
    }
  }
  // One output, one next step (ADR-0014 Notes): only a parallel container starts several branches.
  const fanout = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.fromHandle === PARALLEL_START) continue;
    const key = `${e.from}\u0000${e.fromHandle}`;
    fanout.set(key, [...(fanout.get(key) ?? []), e.id]);
  }
  for (const [key, edgeIds] of fanout) {
    if (edgeIds.length < 2) continue;
    const [blockId, handle] = key.split("\u0000") as [string, string];
    out.push(
      diag("EDGE_FANOUT_NOT_ALLOWED", wfId, {
        blockId,
        message: `'${handle}' of ${byId.get(blockId)!.name} is connected to ${edgeIds.length} blocks — keep one, or put the steps in Run in parallel`,
        data: { handle, edges: [...edgeIds].sort() },
      }),
    );
  }

  // S3 prefetch: every VSS path used by a vss-path prop or a <Vehicle.…> reference
  const exprCache = new Map<string, ReturnType<typeof parseExpression>>();
  const parsed = (b: GraphBlock, prop: string, kind: string, value: string) => {
    const key = `${b.id}\u0000${prop}`;
    if (!exprCache.has(key)) exprCache.set(key, parseExpression(value));
    return exprCache.get(key)!;
  };
  const paths = new Set<string>();
  for (const b of known) {
    for (const p of specs.get(b.type)!.props) {
      const v = (b.props as Record<string, unknown>)[p.name];
      if (p.kind === "vss-path" && typeof v === "string" && v) paths.add(v);
      if (p.kind === "expression" && typeof v === "string" && v.trim()) {
        const r = parsed(b, p.name, p.kind, v);
        if (r.ok) for (const ref of collectRefs(r.ast)) if (ref.kind === "vehicle") paths.add(ref.path.join("."));
      }
      if (p.kind === "template" && typeof v === "string") {
        for (const m of v.matchAll(/<(Vehicle(?:\.[A-Za-z0-9_]+)+)>/g)) paths.add(m[1]!);
      }
    }
  }
  const vss = paths.size ? await ctx.vehicle(graph.vss.release, [...paths].sort()) : new Map<string, VssNode | null>();
  if (graph.vss.modelHash && ctx.modelHash) {
    const current = await ctx.modelHash(graph.vss.release);
    if (current && current !== graph.vss.modelHash) {
      out.push(
        diag("MODEL_HASH_MISMATCH", wfId, {
          message: `VSS ${graph.vss.release} changed since this workflow was designed — re-check the signals it uses`,
          data: { release: graph.vss.release, pinned: graph.vss.modelHash, current },
        }),
      );
    }
  }

  // S2 — block config (props, expressions, references) and S3 — vehicle model
  const variables = new Set(graph.variables.map((v) => v.name));
  const containerOf = (b: GraphBlock, kinds: string[]) => {
    for (let p = b.parentId ? byId.get(b.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (kinds.includes(p.type)) return p;
    }
    return undefined;
  };
  for (const b of known) {
    const spec = specs.get(b.type)!;
    const props = b.props as Record<string, unknown>;
    const resolver: RefResolver = {
      block: (name, field) => {
        const target = byName.get(name);
        if (!target || target.id === b.id) return "unknown-block";
        const ts = specs.get(target.type);
        const out0 = field[0];
        return ts?.outputs.some((o) => o.name === out0) ? {} : undefined;
      },
      vehicle: (path) => {
        const n = vss.get(path);
        return n && n.kind !== "branch" ? { valueType: n.datatype, unit: n.unit ?? null } : undefined;
      },
      variable: (name) => (variables.has(name) ? {} : undefined),
      container: (kind, field) => {
        const c = containerOf(b, kind === "loop" ? ["sv_repeat", "sv_while"] : ["sv_parallel"]);
        return c && specs.get(c.type)?.outputs.some((o) => o.name === field) ? {} : undefined;
      },
    };
    for (const p of spec.props) {
      const v = props[p.name];
      if (isEmpty(v)) {
        // Absent ⇒ the BlockSpec default applies; explicitly cleared (null/"") ⇒ missing.
        if (p.required && (p.default === undefined || v !== undefined)) {
          // sv_stable_for.condition is optional; a missing required loop guard has its own code
          if (b.type === "sv_while" && p.name === "maxIterations") out.push(diag("LOOP_GUARD_MISSING", wfId, { blockId: b.id, field: p.name, message: "While loop needs a maximum number of iterations" }));
          else out.push(diag("BLOCK_PROPERTY_MISSING", wfId, { blockId: b.id, field: p.name, message: `${spec.title}: '${p.name}' is required` }));
        }
        continue;
      }
      if (p.kind === "enum" && p.enum && !p.enum.some((e) => String(e) === String(v))) {
        out.push(diag("BLOCK_PROPERTY_INVALID", wfId, { blockId: b.id, field: p.name, message: `'${String(v)}' is not one of ${p.enum.join(", ")}`, data: { value: v } }));
      }
      if ((p.kind === "duration" || p.kind === "integer" || p.kind === "number") && typeof v === "number") {
        if ((p.kind !== "number" && !Number.isInteger(v)) || (p.min !== undefined && v < p.min) || (p.max !== undefined && v > p.max)) {
          out.push(diag("BLOCK_PROPERTY_INVALID", wfId, { blockId: b.id, field: p.name, message: `'${p.name}' must be ${p.min ?? "−∞"}…${p.max ?? "∞"}${p.kind === "number" ? "" : " (whole number)"}`, data: { value: v } }));
        }
      }
      if (p.kind === "expression" && typeof v === "string") {
        const r = parsed(b, p.name, p.kind, v);
        if (!r.ok) {
          out.push(diag(r.error.code, wfId, { blockId: b.id, field: p.name, message: r.error.message, data: { reason: r.error.reason, span: r.error.span } }));
          continue;
        }
        const ast: Node = r.ast;
        for (const e of checkRefs(ast, resolver).errors) {
          out.push(diag("EXPR_UNKNOWN_REF", wfId, { blockId: b.id, field: p.name, message: e.message, data: { reason: e.reason, ref: e.ref, span: e.span } }));
        }
      }
      if (p.kind === "template" && typeof v === "string") {
        for (const m of v.matchAll(INLINE_REF)) {
          const inner = parseExpression(m[0]);
          if (!inner.ok) continue;
          for (const e of checkRefs(inner.ast, resolver).errors) {
            out.push(diag("EXPR_UNKNOWN_REF", wfId, { blockId: b.id, field: p.name, message: e.message, data: { reason: e.reason, ref: e.ref, span: { start: m.index!, end: m.index! + m[0].length } } }));
          }
        }
      }
    }

    // S3 — vehicle model for the bound path
    const pathProp = spec.props.find((p) => p.kind === "vss-path");
    const path = pathProp ? props[pathProp.name] : undefined;
    if (pathProp && typeof path === "string" && path) {
      const node = vss.get(path);
      if (node === null || node === undefined) {
        out.push(diag("VEHICLE_PATH_NOT_FOUND", wfId, { blockId: b.id, field: pathProp.name, message: `${path} is not a signal of VSS ${graph.vss.release}`, data: { path, release: graph.vss.release } }));
        continue;
      }
      if (node.kind === "branch") {
        out.push(diag("VEHICLE_PATH_IS_BRANCH", wfId, { blockId: b.id, field: pathProp.name, message: `${path} is a group of signals, not a signal`, data: { path } }));
        continue;
      }
      const writes = b.type === "sv_set_actuator";
      if (writes && (node.kind !== "actuator" || (node.datatype && isArrayType(node.datatype)))) {
        out.push(diag("VEHICLE_WRITE_READ_ONLY", wfId, { blockId: b.id, field: pathProp.name, message: `${path} is a ${node.kind}${node.datatype && isArrayType(node.datatype) ? " array" : ""} and cannot be written`, data: { path, kind: node.kind } }));
      } else if (spec.vssKinds && !spec.vssKinds.includes(node.kind as "sensor" | "actuator" | "attribute")) {
        out.push(diag("BLOCK_PROPERTY_INVALID", wfId, { blockId: b.id, field: pathProp.name, message: `${spec.title} needs a ${spec.vssKinds.join(" or ")}, ${path} is a ${node.kind}`, data: { reason: "wrong_kind", path } }));
      }
      if (node.deprecation) {
        out.push(diag("VEHICLE_PATH_DEPRECATED", wfId, { blockId: b.id, field: pathProp.name, message: `${path} is deprecated: ${node.deprecation}`, data: { path } }));
      }
      // literal values checked against the catalog domain
      for (const field of b.type === "sv_set_actuator" ? ["value"] : b.type === "sv_on_signal_changed" ? ["threshold"] : []) {
        const lit = literalOf(props[field]);
        if (!lit) continue;
        if (node.allowed && !node.allowed.some((a) => String(a) === String(lit.value))) {
          out.push(diag("ENUM_VALUE_NOT_ALLOWED", wfId, { blockId: b.id, field, message: `${String(lit.value)} is not allowed for ${path} (${node.allowed.join(", ")})`, data: { value: lit.value } }));
        } else if (typeof lit.value === "number" && ((node.min !== undefined && lit.value < node.min) || (node.max !== undefined && lit.value > node.max))) {
          out.push(diag("VALUE_OUT_OF_RANGE", wfId, { blockId: b.id, field, message: `${lit.value} is outside ${node.min ?? "−∞"}…${node.max ?? "∞"} for ${path}`, data: { value: lit.value, min: node.min, max: node.max } }));
        }
      }
    }
  }

  // S6 (part) — triggers, reachability, parallel branches, polling hint
  const outgoing = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
  const triggers = known.filter((b) => specs.get(b.type)!.category === TRIGGER_CATEGORY);
  const reached = new Set<string>();
  const queue = triggers.map((t) => t.id);
  while (queue.length) {
    const id = queue.shift()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const e of outgoing.get(id) ?? []) if (byId.has(e.to)) queue.push(e.to);
  }
  for (const t of triggers) {
    if (!(outgoing.get(t.id) ?? []).length) out.push(diag("TRIGGER_WITHOUT_ACTION", wfId, { blockId: t.id, message: `${t.name} starts nothing — connect a step after it` }));
  }
  for (const b of known) {
    if (!reached.has(b.id)) out.push(diag("BLOCK_UNREACHABLE", wfId, { blockId: b.id, message: `${b.name} never runs — it is not connected to a trigger` }));
    if (b.type === "sv_parallel" && !(outgoing.get(b.id) ?? []).some((e) => e.fromHandle === PARALLEL_START)) {
      out.push(diag("PARALLEL_BRANCH_EMPTY", wfId, { blockId: b.id, message: "Run in parallel has no branch" }));
    }
    if (b.type === "sv_on_timer") {
      for (const e of outgoing.get(b.id) ?? []) {
        const next = byId.get(e.to);
        if (next?.type === "sv_read_signal" && (next.props as { source?: unknown }).source === "fresh-read") {
          out.push(diag("POLLING_PREFER_SUBSCRIPTION", wfId, { blockId: next.id, message: "Reading a signal on a timer: 'When signal changes' reacts faster with less load", suggestion: "Use a When signal changes trigger on the same signal" }));
        }
      }
    }
  }

  return sortDiagnostics(out, graph.blocks.map((b) => b.id));
}
