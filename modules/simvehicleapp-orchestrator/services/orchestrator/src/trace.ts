import { ContractValidator } from "@simvehicleapp/contracts";
import type { LogLine, RunEvent, TraceEvent } from "./repo.ts";

/**
 * TraceIngest (ADR-0027 §2–5, M08-T05): toolchain log lines of a run ⇒ `SVTRACE {…}` lines become
 * TraceEvent v1 (node mapped to its block through the generation's trace map), the rest LogLine v1.
 * Events are numbered in one seq space and handed over in batches every `batchMs`.
 *
 * Sampling (§5): above `sampleLimit` node events in a second, further `enter`/`exit`/`value` events of
 * that second are coalesced per (workflow, node, kind) within each batch: the last one is kept with
 * `data.dropped` = how many others it stands for — counts stay exact, the stream stays bounded.
 */

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const TRACE = /SVTRACE (\{.*\})\s*$/;
const SAMPLED = new Set(["enter", "exit", "value"]);
const validator = new ContractValidator();

/** Level of an SDK/runtime log line (`[ERROR]`, `ERROR:`, `[warn]` …), else the agent's guess. */
export function levelOf(msg: string, fallback: LogLine["level"]): LogLine["level"] {
  const m = /(?:^|[\s[(])(ERROR|ERR|FATAL|CRITICAL|WARN|WARNING|INFO|DEBUG|TRACE)(?:[\]):\s]|$)/i.exec(msg);
  if (!m) return fallback;
  const k = m[1]!.toUpperCase();
  return k === "ERROR" || k === "ERR" || k === "FATAL" || k === "CRITICAL" ? "error" : k.startsWith("WARN") ? "warn" : k === "INFO" ? "info" : "debug";
}

export interface IngestOptions {
  runId: string;
  traceMap: Record<string, Record<string, string>>;
  /** Persists and publishes a batch (in seq order). */
  emit(events: RunEvent[]): void;
  /** Called at once (not batched) for lifecycle events, e.g. `app.started`. */
  onLifecycle?(ev: string, e: TraceEvent): void;
  now?: () => number;
  batchMs?: number;
  sampleLimit?: number;
  firstSeq?: number;
}

export class TraceIngest {
  private seq: number;
  private pending: RunEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowStart = 0;
  private windowCount = 0;
  private readonly coalesced = new Map<string, { event: TraceEvent; count: number }>();
  private readonly now: () => number;

  constructor(private readonly o: IngestOptions) {
    this.seq = o.firstSeq ?? 0;
    this.now = o.now ?? Date.now;
  }

  /** One line of the toolchain `run` job. */
  line(l: LogLine) {
    const msg = l.msg.replace(ANSI, "");
    const m = TRACE.exec(msg);
    if (m) {
      const parsed = this.parse(m[1]!);
      if (parsed) return this.trace(parsed);
    }
    this.push({ kind: "log", seq: 0, body: { runId: this.o.runId, seq: 0, ts: l.ts, stream: l.stream, level: l.stream === "system" ? l.level : levelOf(msg, l.level), msg, ...(l.raw ? { raw: l.raw } : {}) } });
  }

  /** A log line of the orchestrator itself (start, stop, timeout) in the run's stream. */
  system(msg: string, level: LogLine["level"] = "info") {
    this.push({ kind: "log", seq: 0, body: { runId: this.o.runId, seq: 0, ts: this.now(), stream: "system", level, msg } });
  }

  /** Emits everything pending (coalesced events included). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flushCoalesced();
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    this.o.emit(batch);
  }

  private parse(json: string): Omit<TraceEvent, "runId" | "seq"> | null {
    let v: unknown;
    try {
      v = JSON.parse(json);
    } catch {
      return null;
    }
    if (!validator.validate("trace-event#/$defs/runtimeLine", v).valid) return null;
    const r = v as { ts: number; wf?: string; run?: number; node?: string; ev: string; data?: Record<string, unknown> };
    const blockId = r.wf && r.node ? this.o.traceMap[r.wf]?.[r.node] : undefined;
    return { ts: r.ts, ...(r.wf ? { wf: r.wf } : {}), ...(r.run !== undefined ? { run: r.run } : {}), ...(r.node ? { node: r.node } : {}), ...(blockId ? { blockId } : {}), ev: r.ev, ...(r.data ? { data: r.data } : {}) };
  }

  private trace(t: Omit<TraceEvent, "runId" | "seq">) {
    const event: TraceEvent = { runId: this.o.runId, seq: 0, ...t };
    if (t.ev.startsWith("app.") || t.ev.startsWith("vdb.")) this.o.onLifecycle?.(t.ev, event);
    if (SAMPLED.has(t.ev) && t.node) {
      const now = this.now();
      if (now - this.windowStart >= 1000) {
        this.flushCoalesced();
        this.windowStart = now;
        this.windowCount = 0;
      }
      if (++this.windowCount > (this.o.sampleLimit ?? 500)) {
        const key = `${t.wf}\u0000${t.node}\u0000${t.ev}`;
        const c = this.coalesced.get(key);
        this.coalesced.set(key, { event, count: (c?.count ?? 0) + 1 });
        this.schedule();
        return;
      }
    }
    this.push({ kind: "trace", seq: 0, body: event });
  }

  private flushCoalesced() {
    for (const { event, count } of this.coalesced.values()) {
      this.push({ kind: "trace", seq: 0, body: { ...event, data: { ...(event.data ?? {}), dropped: count - 1 } } }, false);
    }
    this.coalesced.clear();
  }

  private push(e: RunEvent, schedule = true) {
    const seq = this.seq++;
    e.seq = seq;
    e.body.seq = seq;
    this.pending.push(e);
    if (schedule) this.schedule();
  }

  private schedule() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.o.batchMs ?? 50);
  }
}
