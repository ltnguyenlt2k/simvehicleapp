import { ContractValidator, type DiagnosticV1, type GraphBlock, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { BLOCK_SPECS, type BlockSpec, type CompositeMember, compositeMembers } from "@simvehicleapp/blocks";
import { type Node, parseExpression, type RefExpr } from "@simvehicleapp/expr";
import { isIntegerType, type ValueType } from "@simvehicleapp/types";
import { canonicalUnit } from "@simvehicleapp/units";
import { canonicalJson, sha256Hex, type VssNode } from "@simvehicleapp/vss";
import pkg from "../package.json" with { type: "json" };
import { type CapabilitiesLookup, checkBackend } from "./capabilities.ts";
import { analyzeControlFlow } from "./controlflow.ts";
import { diag, sortDiagnostics } from "./diagnostics.ts";
import { type LintContext, lint, normalizeName } from "./lint.ts";
import { MIGRATIONS, migrateGraph } from "./migrations.ts";
import { type IrExpr, type RefBinding, type Typed, Typer, type TyperDiagnostic } from "./typer.ts";

/**
 * WorkflowGraph → IR v1 (ADR-0014 + Notes, analysis/06 §2–§3). `verify` runs every stage and
 * reports diagnostics; `build` also returns the canonical IR with its `irHash`. Pure apart from the
 * injected catalog/backend lookups: same graph + same catalog ⇒ same IR bytes.
 */

export const IR_VERSION = "1.0.0";
export const COMPILER_VERSION: string = pkg.version;

export interface CompileContext extends LintContext {
  /** Required to build: the IR header carries the catalog model hash of the release. */
  modelHash?: LintContext["modelHash"];
  /** Target backend for S7 (`cpp`, `python`…); omitted ⇒ S7 skipped. */
  backend?: string;
  capabilities?: CapabilitiesLookup;
}

export interface CompileResult {
  diagnostics: DiagnosticV1[];
  /** Present when there is no error. */
  ir?: Record<string, unknown>;
}

const TRIGGERS = "triggers";
const PURE = new Set(["expr", "const"]);
const CONTAINER_START = new Set(["loop-start-source", "parallel-start-source"]);
const DEFAULT_QUEUE_MAX = 8;
const DEFAULT_MAX_RUNS = 4;
/** `<Vehicle.Path>` written inside template text (prop kind `template`, ADR-0013 Notes M03-T11). */
const INLINE_REF = /<([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)>/g;
const validator = new ContractValidator();

/** Trigger/node opcodes this compiler emits (`GET /opcodes`): BlockSpec opcodes after lowering. */
export function knownOpcodes(specs: readonly BlockSpec[] = BLOCK_SPECS): string[] {
  const lowered = (op: string) => (PURE.has(op) ? "logic.eval" : op === "comm.hmi_notify" ? "comm.mqtt_publish" : op);
  return [...new Set(specs.map((s) => lowered(s.opcode)))].sort();
}

/** Placeholders patched once node/signal/state ids are known. */
const P = { node: "@@n:", signal: "@@s:", state: "@@v:", topic: "@@t:" } as const;

export async function compile(graphInput: unknown, ctx: CompileContext, mode: "verify" | "build" = "build"): Promise<CompileResult> {
  const lintDiags = await lint(graphInput, ctx);
  if (lintDiags.some((d) => d.severity === "error")) return { diagnostics: lintDiags };

  const specs = new Map((ctx.specs ?? BLOCK_SPECS).map((s) => [s.type, s]));
  const { graph } = migrateGraph(graphInput as WorkflowGraphV1, specs, ctx.migrations ?? MIGRATIONS);
  const b = new Builder(graph, specs);
  await b.loadVehicle(ctx);
  b.build();
  const wf = graph.workflowId;
  const typed = b.diagnostics;
  let diagnostics = sortDiagnostics([...lintDiags, ...typed], graph.blocks.map((x) => x.id));
  if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };

  // The IR header pins the catalog model (ADR-0014 §1): a service without the lookup is misconfigured.
  if (!ctx.modelHash) throw new Error("compile: a modelHash lookup is required");
  const modelHash = await ctx.modelHash(graph.vss.release);
  if (!modelHash) throw new Error(`compile: the catalog has no model for VSS ${graph.vss.release}`);
  const ir = b.ir(modelHash, `sha256:${sha256Hex(canonicalJson(graphInput))}`);
  const schema = validator.validate("ir", ir);
  if (!schema.valid) {
    // A compiler bug, never a user error: report it with the catalog code for internal failures.
    return {
      diagnostics: [
        ...diagnostics,
        diag("CODEGEN_INTERNAL_ERROR", wf, { message: "The compiler produced an IR that does not match the IR contract", data: { errors: schema.errors.slice(0, 10).map((e) => `${e.instancePath || "/"} ${e.message}`) } }),
      ],
    };
  }
  if (ctx.backend && ctx.capabilities) {
    diagnostics = sortDiagnostics([...diagnostics, ...(await checkBackend(ir as never, ctx.backend, ctx.capabilities))], graph.blocks.map((x) => x.id));
    if (diagnostics.some((d) => d.severity === "error")) return { diagnostics };
  }
  return mode === "build" ? { diagnostics, ir } : { diagnostics };
}

interface Out {
  type: ValueType;
  unit: string | null;
}

class Builder {
  readonly diagnostics: DiagnosticV1[] = [];
  private readonly byId: Map<string, GraphBlock>;
  private readonly byName: Map<string, GraphBlock>;
  private vss = new Map<string, VssNode | null>();
  /** Visit order (DFS preorder from the triggers) of every reachable block, inlined ones included. */
  private order: GraphBlock[] = [];
  /** Typed outputs of each block (`result`, `value`…). */
  private outputs = new Map<string, Map<string, Out>>();
  /** Pure blocks folded into their consumers: their typed expression. */
  private inlined = new Map<string, Typed>();
  private args = new Map<string, Record<string, unknown>>();
  private props = new Map<string, Record<string, unknown>>();
  private signalAccess = new Map<string, Set<"read" | "subscribe" | "write">>();
  private topics = new Map<string, "read" | "write">();
  private containerOf = new Map<string, GraphBlock>();
  private dominatingTrigger = new Map<string, GraphBlock | null>();
  /** Composite blocks (ADR-0045): their member reads, one `vehicle.read` node each. */
  private members = new Map<string, CompositeMember[]>();

  constructor(
    private readonly graph: WorkflowGraphV1,
    private readonly specs: Map<string, BlockSpec>,
  ) {
    this.byId = new Map(graph.blocks.map((x) => [x.id, x]));
    this.byName = new Map(graph.blocks.map((x) => [normalizeName(x.name), x]));
    for (const x of graph.blocks) if (x.parentId) this.containerOf.set(x.id, this.byId.get(x.parentId)!);
  }

  private spec(b: GraphBlock): BlockSpec {
    return this.specs.get(b.type)!;
  }

  private propsOf(b: GraphBlock): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const p of this.spec(b).props) {
      const v = (b.props as Record<string, unknown>)[p.name];
      out[p.name] = v === undefined || v === null || v === "" ? p.default : v;
    }
    return out;
  }

  /** Every VSS path the graph uses, fetched once (S3 already validated them). */
  async loadVehicle(ctx: LintContext): Promise<void> {
    const paths = new Set<string>();
    for (const b of this.graph.blocks) {
      for (const m of this.spec(b) ? compositeMembers(this.spec(b), b.props as Record<string, unknown>) : []) paths.add(m.path);
      for (const p of this.spec(b)?.props ?? []) {
        const v = (b.props as Record<string, unknown>)[p.name];
        if (p.kind === "vss-path" && typeof v === "string" && v) paths.add(v);
        if ((p.kind === "expression" || p.kind === "template") && v !== undefined && v !== null) {
          for (const m of String(v).matchAll(/<(Vehicle(?:\.[A-Za-z0-9_]+)+)>/g)) paths.add(m[1]!);
        }
        if (p.kind === "list" && Array.isArray(v)) {
          for (const row of v) for (const m of JSON.stringify(row).matchAll(/<(Vehicle(?:\.[A-Za-z0-9_]+)+)>/g)) paths.add(m[1]!);
        }
      }
    }
    if (paths.size) this.vss = new Map(await ctx.vehicle(this.graph.vss.release, [...paths].sort()));
  }

  private signalNode(path: string): VssNode {
    return this.vss.get(path)!;
  }

  private use(path: string, access: "read" | "subscribe" | "write") {
    const set = this.signalAccess.get(path) ?? new Set();
    set.add(access);
    this.signalAccess.set(path, set);
  }

  /** Outgoing targets of a handle, sorted by target id (fan-out is rejected by S1 except parallel starts). */
  private targets(b: GraphBlock, handle: string): string[] {
    return this.graph.edges
      .filter((e) => e.from === b.id && e.fromHandle === handle && this.byId.has(e.to))
      .map((e) => e.to)
      .sort();
  }

  /** Handles in BlockSpec order, `case` expanded to `case-0…case-n`. */
  private handlesOf(b: GraphBlock): string[] {
    const out: string[] = [];
    for (const h of this.spec(b).handles.out) {
      if (h === "case") {
        const n = Array.isArray((b.props as { cases?: unknown[] }).cases) ? (b.props as { cases: unknown[] }).cases.length : 0;
        for (let i = 0; i < n; i++) out.push(`case-${i}`);
      } else out.push(h);
    }
    return out;
  }

  build(): void {
    const triggers = this.graph.blocks.filter((x) => this.spec(x)?.category === TRIGGERS).sort((a, c) => (a.id < c.id ? -1 : 1));
    const cf = analyzeControlFlow(this.graph, (x) => this.spec(x)?.category === TRIGGERS);
    const seen = new Set<string>();
    const visit = (b: GraphBlock) => {
      if (seen.has(b.id)) return;
      seen.add(b.id);
      this.order.push(b);
      for (const h of this.handlesOf(b)) for (const t of this.targets(b, h)) visit(this.byId.get(t)!);
    };
    for (const t of triggers) visit(t);
    for (const x of this.order) {
      const doms = triggers.filter((t) => t.id === x.id || cf.dominates(t.id, x.id));
      this.dominatingTrigger.set(x.id, doms.length === 1 ? doms[0]! : null);
    }
    for (const x of this.order) this.lower(x);
  }

  private report(b: GraphBlock, field: string | undefined, d: TyperDiagnostic | { code: string; message: string; data?: Record<string, unknown> }) {
    const data = "span" in d ? { ...d.data, span: d.span } : d.data;
    this.diagnostics.push(diag(d.code, this.graph.workflowId, { blockId: b.id, ...(field ? { field } : {}), message: d.message, ...(data ? { data } : {}) }));
  }

  /** Reference resolution for expressions of block `b` (S2 already checked existence and dominance). */
  private env(b: GraphBlock) {
    return {
      ref: (r: RefExpr): RefBinding | undefined => {
        const [head, ...rest] = r.path as [string, ...string[]];
        switch (r.kind) {
          case "vehicle": {
            const path = r.path.join(".");
            const n = this.signalNode(path);
            this.use(path, "subscribe");
            return { expr: { $signal: `${P.signal}${path}` }, type: n.datatype as ValueType, unit: n.unit ?? null };
          }
          case "variable": {
            const v = this.graph.variables.find((x) => x.name === rest.join("."));
            return v ? { expr: { $state: `${P.state}${v.name}` }, type: v.type as ValueType, unit: null } : undefined;
          }
          case "loop":
          case "parallel": {
            for (let c = this.containerOf.get(b.id); c; c = this.containerOf.get(c.id)) {
              const isLoop = c.type === "sv_repeat" || c.type === "sv_while";
              if ((r.kind === "loop") !== isLoop) continue;
              // index of a bounded loop: 0 … count−1 (repeat) / maxIterations−1 (while)
              const cp = this.propsOf(c);
              const bound = Number(c.type === "sv_repeat" ? cp.count : cp.maxIterations);
              const range = Number.isInteger(bound) && bound >= 1 ? { min: 0n, max: BigInt(bound - 1) } : undefined;
              return { expr: { $ref: `${P.node}${c.id}.${rest.join(".")}` }, type: "uint32", unit: null, ...(range ? { range } : {}) };
            }
            return undefined;
          }
          case "block": {
            const producer = this.byName.get(head);
            if (!producer) return undefined;
            const field = rest.join(".");
            const inl = this.inlined.get(producer.id);
            if (inl) return { expr: structuredClone(inl.expr), type: inl.info.type, unit: inl.unit };
            const out = this.outputs.get(producer.id)?.get(field);
            if (!out) return undefined;
            // a composite output is the `value` of its member's node
            const k = this.members.get(producer.id)?.findIndex((m) => m.output === field) ?? -1;
            return { expr: { $ref: k >= 0 ? `${P.node}${memberKey(producer.id, k)}.value` : `${P.node}${producer.id}.${field}` }, type: out.type, unit: out.unit };
          }
        }
      },
    };
  }

  private parse(b: GraphBlock, field: string, src: unknown): Node | undefined {
    const r = parseExpression(typeof src === "string" ? src : String(src));
    return r.ok ? r.ast : undefined;
  }

  /** Types an expression prop; with `target` the value is stored into that type/unit. */
  private expr(b: GraphBlock, field: string, src: unknown, target?: { type: ValueType; unit: string | null }): Typed | undefined {
    const ast = this.parse(b, field, src);
    if (!ast) return undefined;
    const t = new Typer(this.env(b));
    let v = t.type(ast);
    if (v && target) v = t.assign(v, target, ast.span);
    for (const d of t.diagnostics) this.report(b, field, d);
    return v;
  }

  /** Template prop text: inline `<ref>`s interpolated, braces literal (ADR-0013 Notes M03-T11). */
  private template(b: GraphBlock, field: string, text: unknown): IrExpr {
    const s = typeof text === "string" ? text : "";
    const parts: (string | IrExpr)[] = [];
    let last = 0;
    for (const m of s.matchAll(INLINE_REF)) {
      if (m.index! > last) parts.push(s.slice(last, m.index));
      const typed = this.expr(b, field, m[0]);
      parts.push(typed ? typed.expr : m[0]);
      last = m.index! + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return { $template: parts };
  }

  private setOutputs(b: GraphBlock, outs: Record<string, Out>) {
    this.outputs.set(b.id, new Map(Object.entries(outs)));
  }

  /** Output types from the BlockSpec (`$signal`/`$inferred`/`$element` resolved by the caller). */
  private specOutputs(b: GraphBlock, resolve: (type: string) => Out): Record<string, Out> {
    const out: Record<string, Out> = {};
    for (const o of this.spec(b).outputs) {
      out[o.name] = o.type.startsWith("$") ? resolve(o.type) : { type: o.type as ValueType, unit: null };
    }
    return out;
  }

  private signalOut(path: unknown): Out {
    const n = this.signalNode(String(path));
    return { type: n.datatype as ValueType, unit: n.unit ?? null };
  }

  private lower(b: GraphBlock): void {
    const spec = this.spec(b);
    const p = this.propsOf(b);
    const args: Record<string, unknown> = {};
    switch (spec.opcode) {
      // triggers
      case "event.signal_changed": {
        this.use(String(p.path), "subscribe");
        const sig = this.signalOut(p.path);
        const props: Record<string, unknown> = { mode: p.mode, debounceMs: p.debounceMs };
        if (p.threshold !== undefined && p.threshold !== null && p.threshold !== "") {
          const t = this.expr(b, "threshold", typeof p.threshold === "string" && sig.type === "string" ? JSON.stringify(p.threshold) : p.threshold, sig);
          if (t) props.threshold = t.expr;
        }
        this.props.set(b.id, props);
        this.setOutputs(b, this.specOutputs(b, () => sig));
        return;
      }
      case "event.timer":
        this.props.set(b.id, { intervalMs: p.intervalMs, initialDelayMs: p.initialDelayMs });
        this.setOutputs(b, this.specOutputs(b, () => ({ type: "uint32", unit: null })));
        return;
      case "event.condition": {
        const e = this.expr(b, "expr", p.expr, { type: "boolean", unit: null });
        this.props.set(b.id, { ...(e ? { expr: e.expr } : {}), debounceMs: p.debounceMs });
        this.setOutputs(b, this.specOutputs(b, () => ({ type: "timestamp", unit: null })));
        return;
      }
      case "event.mqtt_message":
        this.topics.set(`${String(p.topic)}\u0000read`, "read");
        this.props.set(b.id, { payloadType: p.payloadType });
        this.setOutputs(b, this.specOutputs(b, () => ({ type: p.payloadType === "json" ? "json" : "string", unit: null })));
        return;
      case "event.app_start":
        this.props.set(b.id, {});
        this.setOutputs(b, {});
        return;
      // pure blocks
      case "expr":
      case "const":
        this.lowerPure(b, p);
        return;
      // vehicle
      case "vehicle.write": {
        this.use(String(p.path), "write");
        const v = this.expr(b, "value", p.value, this.signalOut(p.path));
        if (v) args.value = v.expr;
        Object.assign(args, { signal: `${P.signal}${String(p.path)}`, awaitAck: p.awaitAck, onError: p.onError });
        break;
      }
      case "vehicle.read":
        if (spec.members) {
          const members = compositeMembers(spec, p);
          for (const m of members) this.use(m.path, p.source === "fresh-read" ? "read" : "subscribe");
          this.members.set(b.id, members);
          this.setOutputs(b, Object.fromEntries(members.map((m) => [m.output, this.signalOut(m.path)])));
          args.fresh = p.source === "fresh-read";
          break;
        }
        this.use(String(p.path), p.source === "fresh-read" ? "read" : "subscribe");
        Object.assign(args, { signal: `${P.signal}${String(p.path)}`, fresh: p.source === "fresh-read" });
        this.setOutputs(b, this.specOutputs(b, () => this.signalOut(p.path)));
        break;
      case "vehicle.read_attribute":
        this.use(String(p.path), "read");
        args.signal = `${P.signal}${String(p.path)}`;
        this.setOutputs(b, this.specOutputs(b, () => this.signalOut(p.path)));
        break;
      // control
      case "control.branch":
      case "control.wait_until":
      case "control.while": {
        const c = this.expr(b, "condition", p.condition, { type: "boolean", unit: null });
        if (c) args.condition = c.expr;
        if (spec.opcode === "control.wait_until") args.timeoutMs = p.timeoutMs;
        if (spec.opcode === "control.while") Object.assign(args, { maxIterations: p.maxIterations, intervalMs: p.intervalMs });
        break;
      }
      case "control.stable_for": {
        if (p.condition === undefined || p.condition === null || String(p.condition).trim() === "") {
          const trig = this.dominatingTrigger.get(b.id);
          if (trig && trig.type === "sv_on_signal_changed") {
            const path = String(this.propsOf(trig).path);
            args.condition = { $expr: { op: "==", l: { $signal: `${P.signal}${path}` }, r: { $ref: `${P.node}${trig.id}.value` }, type: "boolean" } };
          } else {
            this.report(b, "condition", { code: "BLOCK_PROPERTY_MISSING", message: "Stable for: write a condition (it can only default to 'the trigger value stays the same' after a single When signal changes)" });
          }
        } else {
          const c = this.expr(b, "condition", p.condition, { type: "boolean", unit: null });
          if (c) args.condition = c.expr;
        }
        args.durationMs = p.durationMs;
        break;
      }
      case "control.wait":
        args.durationMs = p.durationMs;
        break;
      case "control.switch": {
        const v = this.expr(b, "value", p.value);
        const cases = Array.isArray(p.cases) ? (p.cases as { when?: unknown }[]) : [];
        const lowered: unknown[] = [];
        cases.forEach((row, i) => {
          // each case compares like `value == when` (units unified, types checked)
          const cmp = this.expr(b, `cases[${i}].when`, `(${String(p.value)}) == (${String(row.when)})`);
          const when = cmp ? ((cmp.expr as { $expr: { r: unknown } }).$expr.r as IrExpr) : undefined;
          if (when) lowered.push(when);
        });
        if (v) Object.assign(args, { value: v.expr, cases: lowered });
        break;
      }
      case "control.repeat":
        Object.assign(args, { count: p.count, intervalMs: p.intervalMs });
        this.setOutputs(b, { index: { type: "uint32", unit: null } });
        break;
      case "control.parallel":
        args.join = p.join;
        break;
      case "control.stop":
        args.scope = p.scope;
        break;
      // state
      case "state.get": {
        const v = this.graph.variables.find((x) => x.name === p.name)!;
        args.state = `${P.state}${v.name}`;
        this.setOutputs(b, { value: { type: v.type as ValueType, unit: null } });
        break;
      }
      case "state.set": {
        const v = this.graph.variables.find((x) => x.name === p.name)!;
        const val = this.expr(b, "value", p.value, { type: v.type as ValueType, unit: null });
        args.state = `${P.state}${v.name}`;
        if (val) args.value = val.expr;
        break;
      }
      case "state.counter": {
        const v = this.graph.variables.find((x) => x.name === p.name)!;
        if (!isIntegerType(v.type)) this.report(b, "name", { code: "TYPE_MISMATCH", message: `Counter needs a whole-number variable, '${v.name}' is ${v.type}`, data: { reason: "not_integer", type: v.type } });
        Object.assign(args, { state: `${P.state}${v.name}`, op: p.op, step: p.step });
        this.setOutputs(b, { value: { type: v.type as ValueType, unit: null } });
        break;
      }
      // logic with state
      case "logic.in_range": {
        const t = new Typer(this.env(b));
        const parsed = ["value", "low", "high"].map((f) => this.parse(b, f, p[f]));
        if (parsed.every(Boolean)) {
          const call = t.type({ type: "call", name: "in_range", args: parsed as Node[], span: parsed[0]!.span });
          for (const d of t.diagnostics) this.report(b, "value", d);
          if (call) {
            const a = (call.expr as { $expr: { args: unknown[] } }).$expr.args;
            Object.assign(args, { value: a[0], low: a[1], high: a[2], mode: p.mode });
          }
        }
        this.setOutputs(b, { result: { type: "boolean", unit: null }, state: { type: "boolean", unit: null } });
        break;
      }
      // communication
      case "comm.log":
        Object.assign(args, { level: p.level, message: this.template(b, "message", p.message) });
        break;
      case "comm.mqtt_publish":
        this.topics.set(`${String(p.topic)}\u0000write`, "write");
        Object.assign(args, { topic: `${P.topic}${String(p.topic)}\u0000write`, payload: this.template(b, "payload", p.payload), payloadType: p.payloadType, qos: Number(p.qos), retain: p.retain });
        break;
      case "comm.hmi_notify": {
        const topic = `simvehicleapp/${kebab(this.graph.name)}/hmi`;
        this.topics.set(`${topic}\u0000write`, "write");
        const str = (e: IrExpr) => ({ $expr: { op: "json.string", value: e, type: "string" } });
        const payload = {
          $template: [
            `{"severity":"${String(p.severity)}","title":`,
            str(this.template(b, "title", p.title)),
            ',"message":',
            str(this.template(b, "message", p.message)),
            ',"ts":',
            { $expr: { op: "now_ms", args: [], type: "timestamp" } },
            "}",
          ],
        };
        Object.assign(args, { topic: `${P.topic}${topic}\u0000write`, payload, payloadType: "json", qos: 0, retain: false });
        break;
      }
      default:
        throw new Error(`no lowering for opcode ${spec.opcode} (${b.type})`);
    }
    // Plain-typed outputs (write `ok`/`error`…) unless the case above resolved them.
    if (!this.outputs.has(b.id)) this.setOutputs(b, this.specOutputs(b, (t) => { throw new Error(`unresolved output type ${t} of ${b.type}`); }));
    this.args.set(b.id, args);
  }

  /** Pure blocks: typed expression, inlined when stable and the error branch is unused (ADR-0014 Notes §11). */
  private lowerPure(b: GraphBlock, p: Record<string, unknown>): void {
    const typed = this.pureExpression(b, p);
    if (!typed) return;
    const out = this.spec(b).outputs[0]!.name;
    this.setOutputs(b, { [out]: { type: typed.info.type, unit: typed.unit } });
    const errorUsed = this.targets(b, "error").length > 0;
    if (!errorUsed && isStable(typed.expr)) this.inlined.set(b.id, typed);
    else this.args.set(b.id, { value: typed.expr });
  }

  private pureExpression(b: GraphBlock, p: Record<string, unknown>): Typed | undefined {
    const src = (x: unknown) => `(${String(x)})`;
    switch (b.type) {
      case "sv_expression":
        return this.expr(b, "expr", p.expr);
      case "sv_compare":
        return this.expr(b, "left", `${src(p.left)} ${String(p.op)} ${src(p.right)}`);
      case "sv_math": {
        const op = String(p.op);
        if (["abs", "round", "floor", "ceil"].includes(op)) return this.expr(b, "a", `${op}${src(p.a)}`);
        if (op === "min" || op === "max") return this.expr(b, "a", `${op}(${String(p.a)}, ${String(p.b)})`);
        return this.expr(b, "a", `${src(p.a)} ${op} ${src(p.b)}`);
      }
      case "sv_bool": {
        const inputs = (Array.isArray(p.inputs) ? (p.inputs as { value?: unknown }[]) : []).map((r) => src(r.value));
        const op = String(p.op);
        const text = op === "not" ? `!${inputs[0] ?? "false"}` : op === "xor" ? inputs.map((x) => `(${x} ? 1 : 0)`).join(" + ").concat(" % 2 == 1") : inputs.join(op === "and" ? " && " : " || ");
        return this.expr(b, "inputs", text || "true");
      }
      case "sv_clamp":
        return this.expr(b, "value", `clamp(${String(p.value)}, ${String(p.min)}, ${String(p.max)})`);
      case "sv_scale": {
        const scaled = `scale(${String(p.value)}, ${String(p.inMin)}, ${String(p.inMax)}, ${String(p.outMin)}, ${String(p.outMax)})`;
        const lo = Math.min(Number(p.outMin), Number(p.outMax));
        const hi = Math.max(Number(p.outMin), Number(p.outMax));
        return this.expr(b, "value", p.clamp === false ? scaled : `clamp(${scaled}, ${lo}, ${hi})`);
      }
      case "sv_lookup": {
        const rows = Array.isArray(p.table) ? (p.table as { when?: unknown; then?: unknown }[]) : [];
        const text = rows.reduceRight((acc, r) => `(${src(p.value)} == ${src(r.when)}) ? ${src(r.then)} : ${acc}`, src(p.default));
        return this.expr(b, "table", text);
      }
      case "sv_array_length":
        return this.expr(b, "array", `len(${String(p.array)})`);
      case "sv_array_contains":
        return this.expr(b, "value", `contains(${String(p.array)}, ${String(p.value)})`);
      case "sv_array_at":
        return this.expr(b, "index", `at(${String(p.array)}, ${String(p.index)}${p.default !== undefined && p.default !== null && p.default !== "" ? `, ${String(p.default)}` : ""})`);
      case "sv_convert": {
        const v = this.expr(b, "value", p.value);
        if (!v) return undefined;
        const t = new Typer(this.env(b));
        const r = t.convert(v, String(p.to), { start: 0, end: 0 });
        for (const d of t.diagnostics) this.report(b, "to", d);
        return r;
      }
      case "sv_constant": {
        const type = String(p.type) as ValueType;
        const lit = type === "string" ? JSON.stringify(String(p.value ?? "")) : String(p.value);
        return this.expr(b, "value", lit, { type, unit: null });
      }
      default:
        throw new Error(`no lowering for pure block ${b.type}`);
    }
  }

  /** Assembles the IR: ids, tables, placeholders patched, canonical order, hash. */
  ir(modelHash: string, sourceGraphHash: string): Record<string, unknown> {
    const nodeId = new Map<string, string>();
    let n = 0;
    for (const b of this.order) {
      if (this.inlined.has(b.id)) continue;
      nodeId.set(b.id, `n${++n}`);
      // composite members: the block's own id is its first member's node
      const members = this.members.get(b.id) ?? [];
      members.forEach((_, k) => nodeId.set(memberKey(b.id, k), k === 0 ? nodeId.get(b.id)! : `n${++n}`));
    }

    const signalPaths = [...this.signalAccess.keys()].sort();
    const signalId = new Map(signalPaths.map((path, i) => [path, `s${i}`]));
    const topicKeys = [...this.topics.keys()].sort();
    const topicId = new Map(topicKeys.map((k, i) => [k, `t${i}`]));
    const vars = [...this.graph.variables].sort((a, c) => (a.name < c.name ? -1 : a.name > c.name ? 1 : 0));
    const stateId = new Map(vars.map((v, i) => [v.name, `v${i}`]));

    const patch = (v: unknown): unknown => {
      if (typeof v === "string") {
        if (v.startsWith(P.node)) {
          const [bid, ...field] = v.slice(P.node.length).split(".");
          return `${nodeId.get(bid!)}.${field.join(".")}`;
        }
        if (v.startsWith(P.signal)) return signalId.get(v.slice(P.signal.length));
        if (v.startsWith(P.state)) return stateId.get(v.slice(P.state.length));
        if (v.startsWith(P.topic)) return topicId.get(v.slice(P.topic.length));
        return v;
      }
      if (Array.isArray(v)) return v.map(patch);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, patch(x)]));
      return v;
    };

    /** Next node of a handle, following through inlined blocks. */
    const follow = (blockId: string | undefined): string | null => {
      let id = blockId;
      while (id && this.inlined.has(id)) id = this.targets(this.byId.get(id)!, "source")[0];
      return id ? nodeId.get(id) ?? null : null;
    };
    const nextOf = (b: GraphBlock): Record<string, string | null> => {
      const next: Record<string, string | null> = {};
      for (const h of this.handlesOf(b)) {
        if (CONTAINER_START.has(h)) continue;
        const key = h === "source" || h === "loop-end-source" || h === "parallel-end-source" ? "next" : h.replace(/-/g, "_");
        next[key] = follow(this.targets(b, h)[0]);
      }
      return next;
    };
    const outputsOf = (b: GraphBlock) => {
      const outs = this.outputs.get(b.id);
      if (!outs || outs.size === 0) return undefined;
      return Object.fromEntries([...outs].sort(([a], [c]) => (a < c ? -1 : 1)).map(([k, o]) => [k, o.unit ? { type: o.type, unit: o.unit } : { type: o.type }]));
    };

    const triggers: Record<string, unknown>[] = [];
    const nodes: Record<string, unknown>[] = [];
    for (const b of this.order) {
      const id = nodeId.get(b.id);
      if (!id) continue;
      const spec = this.spec(b);
      const p = this.propsOf(b);
      const src = { blockId: b.id };
      if (spec.category === TRIGGERS) {
        const t: Record<string, unknown> = { id, opcode: spec.opcode, props: patch(this.props.get(b.id) ?? {}), outputs: outputsOf(b) ?? {}, entry: follow(this.targets(b, "source")[0]), src };
        if (spec.opcode === "event.signal_changed") t.signal = signalId.get(String(p.path));
        if (spec.opcode === "event.mqtt_message") t.topic = topicId.get(`${String(p.topic)}\u0000read`);
        if (spec.opcode !== "event.app_start") {
          const policy = String(p.concurrency);
          t.concurrency = policy === "queue" ? { policy, queueMax: DEFAULT_QUEUE_MAX } : policy === "parallel" ? { policy, maxRuns: DEFAULT_MAX_RUNS } : { policy };
        }
        triggers.push(t);
        continue;
      }
      const members = this.members.get(b.id);
      if (members) {
        // ADR-0045: one `vehicle.read` per member, chained; any failing member takes the block's `error` handle
        const next = nextOf(b);
        const fresh = (this.args.get(b.id) ?? {}).fresh;
        members.forEach((m, k) => {
          const out = this.outputs.get(b.id)!.get(m.output)!;
          nodes.push({
            id: nodeId.get(memberKey(b.id, k)),
            opcode: "vehicle.read",
            args: { signal: signalId.get(m.path), fresh },
            next: { ...next, next: k + 1 < members.length ? nodeId.get(memberKey(b.id, k + 1))! : next.next ?? null },
            outputs: { timestamp: { type: "timestamp" }, value: out.unit ? { type: out.type, unit: out.unit } : { type: out.type } },
            src: k === 0 ? src : { ...src, inserted: true, reason: `composite member ${m.output}` },
          });
        });
        continue;
      }
      const opcode = PURE.has(spec.opcode) ? "logic.eval" : spec.opcode === "comm.hmi_notify" ? "comm.mqtt_publish" : spec.opcode;
      const node: Record<string, unknown> = { id, opcode, args: patch(this.args.get(b.id) ?? {}), next: nextOf(b), src };
      if (spec.opcode === "control.repeat" || spec.opcode === "control.while") node.body = { entry: follow(this.targets(b, "loop-start-source")[0]) };
      if (spec.opcode === "control.parallel") {
        (node.args as Record<string, unknown>).branches = this.targets(b, "parallel-start-source").map((t) => ({ entry: follow(t) }));
      }
      const outs = outputsOf(b);
      if (outs) node.outputs = outs;
      nodes.push(node);
    }

    const signals = signalPaths.map((path) => {
      const s = this.signalNode(path);
      return { id: signalId.get(path)!, path, vssType: s.kind, dataType: s.datatype, unit: s.unit ? (canonicalUnit(s.unit) ?? s.unit) : null, access: [...this.signalAccess.get(path)!].sort() };
    });
    const topics = topicKeys.map((k) => {
      const [topic, direction] = k.split("\u0000") as [string, "read" | "write"];
      return { id: topicId.get(k)!, topic, direction };
    });
    const state = vars.map((v) => ({ id: stateId.get(v.name)!, name: v.name, type: v.type, initial: v.type === "int64" || v.type === "uint64" ? String(v.initial) : v.initial }));

    const ir: Record<string, unknown> = {
      irVersion: IR_VERSION,
      compilerVersion: COMPILER_VERSION,
      workflowId: this.graph.workflowId,
      workflowRevision: this.graph.revision,
      name: pascal(this.graph.name),
      modelHash,
      sourceGraphHash,
      signals,
      topics,
      state,
      triggers,
      nodes,
      diagnostics: [],
    };
    // Round-trip through canonical JSON: sorted keys, canonical numbers, no undefined.
    const canonical = JSON.parse(canonicalJson(ir)) as Record<string, unknown>;
    canonical.irHash = `sha256:${sha256Hex(canonicalJson(canonical))}`;
    return JSON.parse(canonicalJson(canonical)) as Record<string, unknown>;
  }
}

/** Node key of member `k` of a composite block (`#` is not allowed in block ids, so keys never collide). */
const memberKey = (blockId: string, k: number) => `${blockId}#${k}`;

/** Stable within a run: only `$ref`, constants and pure operators (no `$signal`, `$state`, `now_ms`). */
function isStable(e: unknown): boolean {
  if (Array.isArray(e)) return e.every(isStable);
  if (e && typeof e === "object") {
    if ("$signal" in e || "$state" in e) return false;
    if ("$expr" in e && (e as { $expr: { op: string } }).$expr.op === "now_ms") return false;
    return Object.values(e).every(isStable);
  }
  return true;
}

/** IR `name` (PascalCase, ADR-0014 Notes §3). */
export function pascal(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const joined = parts.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return !joined || /^[0-9]/.test(joined) ? `App${joined}` : joined;
}

export function kebab(name: string): string {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .join("-") || "app"
  );
}

