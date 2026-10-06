import { EvalError, type EvalContext, type Expr, evaluate, fromJson, toJson, type Value, cast } from "./values.ts";

/**
 * IR v1 simulator (ADR-0017, execution semantics ADR-0012 + Notes, executable spec = conformance
 * C01…C38). Pure and deterministic: one strand, a virtual clock ordered by (t, seq), generator
 * fibers for runs and parallel branches, cancel by token. No I/O.
 */

export interface ScenarioInput {
  t: number;
  path?: string;
  topic?: string;
  value: unknown;
}

export interface SimulateOptions {
  until: number;
  initial?: Record<string, unknown>;
  inputs?: ScenarioInput[];
  latency?: { read?: number; write?: number };
  /** Optional VSS bounds/allowed of written signals (runtime write validation). */
  model?: Record<string, { min?: number; max?: number; allowed?: unknown[] }>;
  runId?: string;
  /** ADR-0017 §5. */
  maxEvents?: number;
}

export interface TraceEvent {
  runId: string;
  seq: number;
  ts: number;
  wf?: string;
  run?: number;
  node?: string;
  blockId?: string;
  ev: string;
  data?: Record<string, unknown>;
}

export interface SimulationResult {
  trace: TraceEvent[];
  /** Signal values applied from the scenario (Simulation timeline). */
  signals: { t: number; path: string; value: unknown }[];
  writes: { t: number; path: string; value: unknown }[];
  publishes: { t: number; topic: string; payload: string }[];
  logs: { t: number; level: string; message: string }[];
  /** Set when a limit stopped the simulation (SIM_LIMIT_REACHED). */
  limit?: { reason: "events"; events: number; t: number };
  stats: { events: number; runs: number; virtualMs: number };
}

export const MAX_UNTIL = 86_400_000;
export const MAX_EVENTS = 1_000_000;

type Node = { id: string; opcode: string; args: Expr; next: Record<string, string | null>; body?: { entry: string | null }; outputs?: Record<string, { type: string }>; src: { blockId: string } };
type Trigger = { id: string; opcode: string; signal?: string; topic?: string; props: Expr; concurrency?: { policy: string; queueMax?: number; maxRuns?: number }; outputs: Record<string, { type: string }>; entry: string | null; src: { blockId: string } };
type Ir = { workflowId: string; signals: { id: string; path: string; dataType: string }[]; topics: { id: string; topic: string; direction: string }[]; state: { id: string; name: string; type: string; initial: unknown }[]; triggers: Trigger[]; nodes: Node[] };

/** What a fiber asks the scheduler for. */
type Effect =
  | { kind: "sleep"; ms: number }
  | { kind: "until"; cond: () => boolean; timeoutMs: number; wantTrue: boolean }
  | { kind: "join"; fibers: Fiber[]; mode: "all" | "any" };
type Resume = "ok" | "timeout" | "done" | undefined;

class Token {
  cancelled = false;
  readonly children: Token[] = [];
  constructor(readonly parent?: Token) {
    parent?.children.push(this);
  }
  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const c of this.children) c.cancel();
  }
}

class Fiber {
  done = false;
  readonly waiters: (() => void)[] = [];
  constructor(
    readonly run: Run,
    readonly gen: Generator<Effect, void, Resume>,
    readonly token: Token,
  ) {}
}

class Run {
  readonly outputs = new Map<string, Record<string, Value>>();
  readonly fibers = new Set<Fiber>();
  finished = false;
  constructor(
    readonly n: number,
    readonly trigger: Trigger,
    readonly token: Token,
  ) {}
}

interface Waiter {
  fiber: Fiber;
  cond: () => boolean;
  wantTrue: boolean;
  timer?: number;
}

export function simulate(irDoc: unknown, options: SimulateOptions): SimulationResult {
  return new Simulator(irDoc as Ir, options).run();
}

class Simulator {
  private t = 0;
  private seq = 0;
  private traceSeq = 0;
  private events = 0;
  private readonly heap: { t: number; seq: number; id: number; fn: () => void }[] = [];
  private cancelledTimers = new Set<number>();
  private readonly nodes: Map<string, Node>;
  private readonly signalById: Map<string, Ir["signals"][number]>;
  private readonly signalByPath: Map<string, Ir["signals"][number]>;
  private readonly topicById: Map<string, Ir["topics"][number]>;
  private readonly values = new Map<string, Value | undefined>();
  private readonly state = new Map<string, Value>();
  private readonly stateType = new Map<string, string>();
  private readonly runsOf = new Map<string, Run[]>();
  private readonly queues = new Map<string, (() => void)[]>();
  private readonly waiters = new Set<Waiter>();
  private readonly conditionLast = new Map<string, boolean>();
  private readonly debounce = new Map<string, number>();
  private readonly hysteresis = new Map<string, boolean>();
  private readonly appToken = new Token();
  private runCount = 0;
  private stopped = false;
  private readonly result: SimulationResult;
  private readonly runId: string;

  constructor(
    private readonly ir: Ir,
    private readonly opts: SimulateOptions,
  ) {
    if (opts.until < 0 || opts.until > MAX_UNTIL) throw new RangeError(`until must be 0…${MAX_UNTIL} ms`);
    this.nodes = new Map(ir.nodes.map((n) => [n.id, n]));
    this.signalById = new Map(ir.signals.map((s) => [s.id, s]));
    this.signalByPath = new Map(ir.signals.map((s) => [s.path, s]));
    this.topicById = new Map(ir.topics.map((t) => [t.id, t]));
    this.runId = opts.runId ?? "sim";
    this.result = { trace: [], signals: [], writes: [], publishes: [], logs: [], stats: { events: 0, runs: 0, virtualMs: opts.until } };
    for (const s of ir.state) {
      this.state.set(s.id, fromJson(s.initial, s.type));
      this.stateType.set(s.id, s.type);
    }
    for (const [path, v] of Object.entries(opts.initial ?? {})) {
      const s = this.signalByPath.get(path);
      if (s) this.values.set(s.id, fromJson(v, s.dataType));
    }
  }

  // ---- scheduler -------------------------------------------------------
  private schedule(t: number, fn: () => void): number {
    const id = this.seq++;
    this.heap.push({ t, seq: id, id, fn });
    this.siftUp(this.heap.length - 1);
    return id;
  }
  private siftUp(i: number) {
    const h = this.heap;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p]!.t < h[i]!.t || (h[p]!.t === h[i]!.t && h[p]!.seq < h[i]!.seq)) break;
      [h[p], h[i]] = [h[i]!, h[p]!];
      i = p;
    }
  }
  private pop() {
    const h = this.heap;
    const top = h[0]!;
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const less = (a: number, b: number) => h[a]!.t < h[b]!.t || (h[a]!.t === h[b]!.t && h[a]!.seq < h[b]!.seq);
        if (l < h.length && less(l, m)) m = l;
        if (r < h.length && less(r, m)) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i]!, h[m]!];
        i = m;
      }
    }
    return top;
  }

  run(): SimulationResult {
    const max = this.opts.maxEvents ?? MAX_EVENTS;
    // inputs first (lowest seq at each instant), then app start at t=0, timers
    for (const input of this.opts.inputs ?? []) this.schedule(input.t, () => this.applyInput(input));
    this.schedule(0, () => this.startApp());
    while (this.heap.length && !this.stopped) {
      const e = this.pop();
      if (e.t > this.opts.until) break;
      if (this.cancelledTimers.delete(e.id)) continue;
      this.t = e.t;
      if (++this.events > max) {
        this.result.limit = { reason: "events", events: max, t: this.t };
        break;
      }
      e.fn();
    }
    this.result.stats = { events: this.events, runs: this.runCount, virtualMs: this.opts.until };
    return this.result;
  }

  // ---- tracing ---------------------------------------------------------
  /** `run: 0` marks an event of a trigger outside any run (queue overflow, unparsable MQTT payload). */
  private trace(ev: string, extra: { run?: Run; node?: string; blockId?: string; data?: Record<string, unknown> } = {}) {
    const e: TraceEvent = { runId: this.runId, seq: this.traceSeq++, ts: this.t, ev };
    if (extra.run || extra.node) {
      e.wf = this.ir.workflowId;
      e.run = extra.run ? extra.run.n : 0;
    }
    if (extra.node) e.node = extra.node;
    if (extra.blockId) e.blockId = extra.blockId;
    if (extra.data) e.data = extra.data;
    this.result.trace.push(e);
  }

  // ---- inputs, signals, triggers -------------------------------------
  private startApp() {
    for (const t of this.sortedTriggers()) {
      if (t.opcode === "event.app_start") this.fire(t, {});
      if (t.opcode === "event.timer") this.scheduleTick(t, Number(t.props.initialDelayMs ?? 0), 1);
      if (t.opcode === "event.condition") this.conditionLast.set(t.id, this.safeBool(t.props.expr));
    }
  }

  private sortedTriggers() {
    return [...this.ir.triggers].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }

  private scheduleTick(t: Trigger, at: number, tick: number) {
    this.schedule(at, () => {
      this.fire(t, { tick: BigInt(tick), timestamp: BigInt(this.t) });
      this.scheduleTick(t, at + Number(t.props.intervalMs), tick + 1);
    });
  }

  private applyInput(input: ScenarioInput) {
    if (input.topic !== undefined) {
      this.deliverMqtt(input.topic, typeof input.value === "string" ? input.value : JSON.stringify(input.value));
      return;
    }
    const s = this.signalByPath.get(input.path!);
    if (!s) return; // a signal the app does not use
    const prev = this.values.get(s.id);
    const next = fromJson(input.value, s.dataType);
    this.values.set(s.id, next);
    this.result.signals.push({ t: this.t, path: s.path, value: toJson(next, s.dataType) });
    for (const t of this.sortedTriggers()) {
      if (t.opcode !== "event.signal_changed" || t.signal !== s.id) continue;
      if (!this.modeMatches(t, prev, next)) continue;
      const outputs = { value: next, previous: prev ?? null, timestamp: BigInt(this.t) };
      const debounceMs = Number(t.props.debounceMs ?? 0);
      if (debounceMs > 0) {
        const old = this.debounce.get(t.id);
        if (old !== undefined) this.cancelledTimers.add(old);
        this.debounce.set(
          t.id,
          this.schedule(this.t + debounceMs, () => {
            this.debounce.delete(t.id);
            this.fire(t, { ...outputs, value: this.values.get(s.id) ?? null, timestamp: BigInt(this.t) });
          }),
        );
      } else this.fire(t, outputs);
    }
    this.afterChange();
  }

  private modeMatches(t: Trigger, prev: Value | undefined, next: Value): boolean {
    const eq = (a: Value | undefined, b: Value | undefined) => a !== undefined && b !== undefined && (typeof a === "bigint" || typeof b === "bigint" ? String(a) === String(b) : a === b);
    const n = (v: Value | undefined) => (typeof v === "bigint" ? Number(v) : Number(v));
    const th = t.props.threshold !== undefined ? this.eval(t.props.threshold, undefined) : undefined;
    switch (String(t.props.mode ?? "any")) {
      case "any":
        return !eq(prev, next);
      case "rising":
        return prev !== undefined && n(next) > n(prev);
      case "falling":
        return prev !== undefined && n(next) < n(prev);
      case "crosses_above":
        return prev !== undefined && n(prev) <= n(th) && n(th) < n(next);
      case "crosses_below":
        return prev !== undefined && n(prev) >= n(th) && n(th) > n(next);
      case "becomes":
        return eq(next, th) && !eq(prev, th);
      default:
        return false;
    }
  }

  /** After a signal/state change: condition triggers (rising edge) and waiting fibers. */
  private afterChange() {
    for (const t of this.sortedTriggers()) {
      if (t.opcode !== "event.condition") continue;
      const now = this.safeBool(t.props.expr);
      const before = this.conditionLast.get(t.id) ?? false;
      this.conditionLast.set(t.id, now);
      const debounceMs = Number(t.props.debounceMs ?? 0);
      if (now && !before) {
        if (debounceMs > 0) {
          this.debounce.set(t.id, this.schedule(this.t + debounceMs, () => {
            this.debounce.delete(t.id);
            if (this.safeBool(t.props.expr)) this.fire(t, { timestamp: BigInt(this.t) });
          }));
        } else this.fire(t, { timestamp: BigInt(this.t) });
      } else if (!now && this.debounce.has(t.id)) {
        this.cancelledTimers.add(this.debounce.get(t.id)!);
        this.debounce.delete(t.id);
      }
    }
    for (const w of [...this.waiters]) {
      if (w.fiber.token.cancelled) {
        this.waiters.delete(w);
        continue;
      }
      if (this.safeCond(w.cond) === w.wantTrue) {
        this.waiters.delete(w);
        if (w.timer !== undefined) this.cancelledTimers.add(w.timer);
        this.step(w.fiber, "ok");
      }
    }
  }

  private deliverMqtt(topic: string, payload: string) {
    for (const t of this.sortedTriggers()) {
      if (t.opcode !== "event.mqtt_message") continue;
      const filter = this.topicById.get(t.topic!)?.topic ?? "";
      if (!topicMatches(filter, topic)) continue;
      let value: Value = payload;
      if (t.props.payloadType === "json") {
        try {
          value = JSON.parse(payload) as Value;
        } catch {
          this.trace("error", { node: t.id, blockId: t.src.blockId, data: { reason: "payload_not_json", topic } });
          continue;
        }
      }
      this.fire(t, { payload: value, topic });
    }
  }

  // ---- concurrency -------------------------------------------------------
  private active(t: Trigger) {
    return (this.runsOf.get(t.id) ?? []).filter((r) => !r.finished);
  }

  private fire(t: Trigger, outputs: Record<string, Value>) {
    if (this.stopped) return;
    const policy = t.concurrency?.policy ?? "parallel";
    const active = this.active(t);
    const start = () => this.startRun(t, outputs);
    if (t.opcode === "event.app_start" || active.length === 0) return start();
    switch (policy) {
      case "restart":
        for (const r of active) this.cancelRun(r, "restart");
        return start();
      case "ignore":
        return;
      case "queue": {
        const q = this.queues.get(t.id) ?? [];
        if (q.length >= (t.concurrency?.queueMax ?? 8)) {
          q.shift();
          this.trace("error", { node: t.id, blockId: t.src.blockId, data: { reason: "queue_overflow" } });
        }
        q.push(start);
        this.queues.set(t.id, q);
        return;
      }
      case "parallel":
        if (active.length >= (t.concurrency?.maxRuns ?? 4)) return;
        return start();
    }
  }

  private startRun(t: Trigger, outputs: Record<string, Value>) {
    const run = new Run(++this.runCount, t, new Token(this.appToken));
    run.outputs.set(t.id, outputs);
    this.runsOf.set(t.id, [...(this.runsOf.get(t.id) ?? []).filter((r) => !r.finished), run]);
    this.trace("trigger", { run, node: t.id, blockId: t.src.blockId, data: { outputs: jsonOutputs(outputs, t.outputs) } });
    this.spawn(run, run.token, this.chain(run, t.entry), true);
  }

  private cancelRun(run: Run, reason: string) {
    if (run.finished) return;
    run.token.cancel();
    run.finished = true;
    this.trace("cancel", { run, node: run.trigger.id, blockId: run.trigger.src.blockId, data: { reason } });
  }

  private finishRun(run: Run) {
    if (run.finished) return;
    run.finished = true;
    const q = this.queues.get(run.trigger.id);
    const next = q?.shift();
    if (next) next();
  }

  // ---- fibers --------------------------------------------------------------
  private spawn(run: Run, token: Token, gen: Generator<Effect, void, Resume>, root = false): Fiber {
    const f = new Fiber(run, gen, token);
    run.fibers.add(f);
    const finish = () => {
      run.fibers.delete(f);
      if (root || [...run.fibers].length === 0) {
        if ([...run.fibers].length === 0) this.finishRun(run);
      }
    };
    (f as Fiber & { onDone?: () => void }).onDone = finish;
    this.step(f, undefined);
    return f;
  }

  private step(f: Fiber, input: Resume) {
    if (f.done) return;
    if (f.token.cancelled) return this.complete(f);
    let r: IteratorResult<Effect, void>;
    try {
      r = f.gen.next(input);
    } catch (e) {
      if (e instanceof StopRun) {
        this.complete(f);
        return;
      }
      throw e;
    }
    if (r.done) return this.complete(f);
    const effect = r.value;
    switch (effect.kind) {
      case "sleep":
        this.schedule(this.t + effect.ms, () => this.step(f, undefined));
        return;
      case "until": {
        const w: Waiter = { fiber: f, cond: effect.cond, wantTrue: effect.wantTrue };
        w.timer = this.schedule(this.t + effect.timeoutMs, () => {
          if (!this.waiters.delete(w)) return;
          this.step(f, "timeout");
        });
        this.waiters.add(w);
        return;
      }
      case "join": {
        const pending = effect.fibers.filter((c) => !c.done);
        if (effect.mode === "all" && pending.length === 0) return this.schedule(this.t, () => this.step(f, "done")), undefined;
        if (effect.mode === "any" && pending.length < effect.fibers.length) {
          for (const c of pending) c.token.cancel();
          this.schedule(this.t, () => this.step(f, "done"));
          return;
        }
        let resumed = false;
        for (const c of pending) {
          c.waiters.push(() => {
            if (resumed) return;
            const left = effect.fibers.filter((x) => !x.done);
            if (effect.mode === "any" || left.length === 0) {
              resumed = true;
              if (effect.mode === "any") for (const x of left) x.token.cancel();
              this.schedule(this.t, () => this.step(f, "done"));
            }
          });
        }
        return;
      }
    }
  }

  private complete(f: Fiber) {
    if (f.done) return;
    f.done = true;
    for (const w of f.waiters) w();
    (f as Fiber & { onDone?: () => void }).onDone?.();
  }

  // ---- evaluation ----------------------------------------------------------
  private ctx(run: Run | undefined): EvalContext {
    return {
      ref: (node, output) => {
        const v = run?.outputs.get(node)?.[output];
        if (v === undefined) throw new EvalError("no_value", `${node}.${output} has no value`);
        return v;
      },
      signal: (id) => this.values.get(id),
      state: (id) => this.state.get(id) ?? null,
      now: () => this.t,
      typeOfRef: (e) => {
        if ("$signal" in e) return this.signalById.get(String(e.$signal))?.dataType;
        if ("$state" in e) return this.stateType.get(String(e.$state));
        if ("$ref" in e) {
          const [id, out] = String(e.$ref).split(".");
          return (this.nodes.get(id!)?.outputs ?? this.ir.triggers.find((t) => t.id === id)?.outputs)?.[out!]?.type;
        }
        return undefined;
      },
    };
  }

  private eval(e: unknown, run: Run | undefined): Value {
    return evaluate(e, this.ctx(run));
  }

  private safeBool(e: unknown): boolean {
    if (e === undefined) return false;
    try {
      return this.eval(e, undefined) === true;
    } catch (err) {
      if (err instanceof EvalError) return false;
      throw err;
    }
  }

  private safeCond(cond: () => boolean): boolean {
    try {
      return cond();
    } catch (err) {
      if (err instanceof EvalError) return false;
      throw err;
    }
  }

  // ---- interpreter -------------------------------------------------------------
  private *chain(run: Run, entry: string | null): Generator<Effect, void, Resume> {
    let id = entry;
    while (id && !run.token.cancelled) {
      const node = this.nodes.get(id)!;
      this.trace("enter", { run, node: id, blockId: node.src.blockId });
      let handle: string | null;
      try {
        handle = yield* this.exec(run, node);
      } catch (e) {
        if (!(e instanceof EvalError)) throw e;
        handle = this.onError(run, node, e.reason, e.message);
      }
      if (run.token.cancelled) return;
      this.trace("exit", { run, node: id, blockId: node.src.blockId, ...(handle ? { data: { handle } } : {}) });
      id = handle ? (node.next[handle] ?? null) : null;
    }
  }

  /** I/O error: `error` branch when connected, else `onError` (continue = log + next, stop = end run). */
  private onError(run: Run, node: Node, reason: string, message: string): string | null {
    run.outputs.set(node.id, { ...(run.outputs.get(node.id) ?? {}), ok: false, error: message });
    this.trace("error", { run, node: node.id, blockId: node.src.blockId, data: { reason, message } });
    if (node.next.error) return "error";
    if (node.args.onError === "stop") return null;
    return "next" in node.next ? "next" : null;
  }

  private *exec(run: Run, node: Node): Generator<Effect, string | null, Resume> {
    const a = node.args;
    const out = (o: Record<string, Value>) => run.outputs.set(node.id, o);
    switch (node.opcode) {
      case "vehicle.write": {
        const s = this.signalById.get(String(a.signal))!;
        const value = cast(this.eval(a.value, run), s.dataType);
        const bounds = this.opts.model?.[s.path];
        const n = typeof value === "bigint" ? Number(value) : value;
        const bad =
          bounds &&
          ((bounds.min !== undefined && typeof n === "number" && n < bounds.min) ||
            (bounds.max !== undefined && typeof n === "number" && n > bounds.max) ||
            (bounds.allowed && !bounds.allowed.some((x) => String(x) === String(value))));
        if (bad) throw new EvalError("no_value", `${String(toJson(value, s.dataType))} is outside the allowed values of ${s.path}`);
        // An actuator write sets its target; the current value changes only when the vehicle reports it.
        this.result.writes.push({ t: this.t, path: s.path, value: toJson(value, s.dataType) });
        this.trace("write", { run, node: node.id, blockId: node.src.blockId, data: { path: s.path, value: toJson(value, s.dataType) } });
        out({ ok: true, error: "" });
        if (a.awaitAck !== false) yield { kind: "sleep", ms: this.opts.latency?.write ?? 0 };
        return "next";
      }
      case "vehicle.read":
      case "vehicle.read_attribute": {
        if (a.fresh === true) yield { kind: "sleep", ms: this.opts.latency?.read ?? 0 };
        const v = this.values.get(String(a.signal));
        if (v === undefined) throw new EvalError("no_value", `${this.signalById.get(String(a.signal))?.path} has no value yet`);
        out({ value: v, timestamp: BigInt(this.t) });
        return "next";
      }
      case "control.branch":
        return this.eval(a.condition, run) === true ? "then" : "else";
      case "control.switch": {
        const v = this.eval(a.value, run);
        const cases = a.cases as unknown[];
        for (let i = 0; i < cases.length; i++) {
          const c = this.eval(cases[i], run);
          if ((typeof v === "bigint" || typeof c === "bigint") ? String(v) === String(c) && typeof c !== "string" ? true : Number(v) === Number(c) && typeof v !== "string" : v === c) return `case_${i}`;
        }
        return "default";
      }
      case "control.wait":
        yield { kind: "sleep", ms: Number(a.durationMs) };
        return "next";
      case "control.wait_until": {
        const cond = () => this.eval(a.condition, run) === true;
        if (this.safeCond(cond)) return "ok";
        const r = yield { kind: "until", cond, timeoutMs: Number(a.timeoutMs), wantTrue: true };
        return r === "ok" ? "ok" : "timeout";
      }
      case "control.stable_for": {
        const cond = () => this.eval(a.condition, run) === true;
        if (!this.safeCond(cond)) return "broken";
        const r = yield { kind: "until", cond, timeoutMs: Number(a.durationMs), wantTrue: false };
        return r === "ok" ? "broken" : "stable";
      }
      case "control.repeat": {
        const count = Number(a.count);
        for (let i = 0; i < count && !run.token.cancelled; i++) {
          if (i > 0 && Number(a.intervalMs) > 0) yield { kind: "sleep", ms: Number(a.intervalMs) };
          out({ index: BigInt(i) });
          yield* this.chain(run, node.body?.entry ?? null);
          yield { kind: "sleep", ms: 0 };
        }
        return "next";
      }
      case "control.while": {
        const max = Number(a.maxIterations);
        for (let i = 0; !run.token.cancelled; i++) {
          if (i > 0 && Number(a.intervalMs) > 0) yield { kind: "sleep", ms: Number(a.intervalMs) };
          if (this.eval(a.condition, run) !== true) break;
          if (i >= max) {
            this.trace("error", { run, node: node.id, blockId: node.src.blockId, data: { reason: "loop_guard", maxIterations: max } });
            run.token.cancel();
            throw new StopRun();
          }
          out({ index: BigInt(i) });
          yield* this.chain(run, node.body?.entry ?? null);
          yield { kind: "sleep", ms: 0 };
        }
        return "next";
      }
      case "control.parallel": {
        const branches = (a.branches as { entry: string | null }[]) ?? [];
        const children = branches.map((b) => this.spawnLater(run, b.entry));
        if (a.join === "none") return "next";
        yield { kind: "join", fibers: children, mode: a.join === "any" ? "any" : "all" };
        return "next";
      }
      case "control.stop": {
        const scope = String(a.scope ?? "run");
        if (scope === "app") {
          this.stopped = true;
          this.appToken.cancel();
        } else if (scope === "workflow") {
          for (const runs of this.runsOf.values()) for (const r of runs) if (r !== run) this.cancelRun(r, "stop");
        }
        run.token.cancel();
        throw new StopRun();
      }
      case "state.get":
        out({ value: this.state.get(String(a.state)) ?? null });
        return "next";
      case "state.set": {
        const id = String(a.state);
        this.state.set(id, cast(this.eval(a.value, run), this.stateType.get(id)!));
        this.afterChange();
        return "next";
      }
      case "state.counter": {
        const id = String(a.state);
        const type = this.stateType.get(id)!;
        const cur = BigInt(String(this.state.get(id) ?? 0));
        const step = BigInt(Number(a.step ?? 1));
        const initial = this.ir.state.find((s) => s.id === id)!.initial;
        const next = a.op === "reset" ? fromJson(initial, type) : cast(a.op === "dec" ? cur - step : cur + step, type);
        this.state.set(id, next);
        out({ value: next });
        this.afterChange();
        return "next";
      }
      case "logic.eval":
        out({ result: this.eval(a.value, run) });
        return "next";
      case "logic.in_range": {
        const v = this.eval(a.value, run);
        const lo = this.eval(a.low, run);
        const hi = this.eval(a.high, run);
        const n = (x: Value) => (typeof x === "bigint" ? Number(x) : Number(x));
        let result: boolean;
        if (a.mode === "hysteresis") {
          let s = this.hysteresis.get(node.id) ?? false;
          if (n(v) >= n(hi)) s = true;
          else if (n(v) <= n(lo)) s = false;
          this.hysteresis.set(node.id, s);
          result = s;
        } else result = n(lo) <= n(v) && n(v) <= n(hi);
        out({ result, state: result });
        return "next";
      }
      case "comm.log": {
        const message = String(this.eval(a.message, run));
        this.result.logs.push({ t: this.t, level: String(a.level ?? "info"), message });
        this.trace("value", { run, node: node.id, blockId: node.src.blockId, data: { kind: "log", level: a.level, message } });
        return "next";
      }
      case "comm.mqtt_publish": {
        const topic = this.topicById.get(String(a.topic))!.topic;
        const payload = String(this.eval(a.payload, run));
        this.result.publishes.push({ t: this.t, topic, payload });
        this.trace("value", { run, node: node.id, blockId: node.src.blockId, data: { kind: "mqtt", topic, payload } });
        this.deliverMqtt(topic, payload);
        return "next";
      }
      default:
        throw new Error(`simulator: opcode ${node.opcode} is not implemented`);
    }
  }

  /** Parallel branch: a child fiber started at the same instant, after the parent's current step. */
  private spawnLater(run: Run, entry: string | null): Fiber {
    const token = new Token(run.token);
    const gen = this.chain(run, entry);
    const f = new Fiber(run, gen, token);
    run.fibers.add(f);
    (f as Fiber & { onDone?: () => void }).onDone = () => {
      run.fibers.delete(f);
      if (run.fibers.size === 0) this.finishRun(run);
    };
    this.schedule(this.t, () => this.step(f, undefined));
    return f;
  }
}

class StopRun extends Error {}

function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

function jsonOutputs(o: Record<string, Value>, spec: Record<string, { type: string }>) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toJson(v, spec[k]?.type)]));
}
