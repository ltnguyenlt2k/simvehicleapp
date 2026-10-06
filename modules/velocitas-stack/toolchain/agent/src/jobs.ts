/**
 * Job queue of the toolchain agent (ADR-0025 §2–4): build-class jobs run one at a time (one Conan
 * cache), a `run` is single too; every job streams LogLine v1 lines (resumable by seq) and ends in
 * succeeded/failed/cancelled with diagnostics. What a job executes comes from a `Planner`, so the
 * queue is tested with fake commands.
 */

export type JobKind = "init" | "deps" | "build" | "test" | "format-check" | "run" | "stop" | "generate-model";
export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobOptions {
  release?: boolean;
  env?: Record<string, string>;
  runJobId?: string;
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  stage: string;
  message: string;
  docs: string;
  data?: Record<string, unknown>;
}

export interface LogLine {
  runId: string;
  seq: number;
  ts: number;
  stream: "stdout" | "stderr" | "system";
  level: "debug" | "info" | "warn" | "error";
  msg: string;
  raw?: string;
}

/** One command of a job; `check` decides success when the exit code cannot be trusted. */
export interface Step {
  label: string;
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Runs before the command; returning false skips it. */
  when?: () => boolean | Promise<boolean>;
  /** After a zero exit: a failure message when the expected result is missing. */
  check?: () => string | null | Promise<string | null>;
  /** After success. */
  after?: () => void | Promise<void>;
}

export interface Plan {
  steps: Step[];
  /** Diagnostic code when the job fails (ADR-0016 catalog). */
  failCode: string;
  failStage: string;
}

export type Planner = (kind: JobKind, project: string, options: JobOptions) => Plan | Promise<Plan>;

export interface Job {
  id: string;
  kind: JobKind;
  project: string;
  options?: JobOptions;
  state: JobState;
  exitCode: number | null;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  diagnostics: Diagnostic[];
}

interface Entry {
  job: Job;
  lines: LogLine[];
  listeners: Set<(l: LogLine | null) => void>;
  proc?: { kill(signal: NodeJS.Signals | number): void; pid: number };
  cancelRequested: boolean;
}

const MAX_LINES = 50_000;
const MAX_JOBS = 200;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const BUILD_KINDS: ReadonlySet<JobKind> = new Set(["init", "deps", "build", "test", "format-check", "generate-model"]);

export class ConflictError extends Error {}

export class JobManager {
  private readonly jobs = new Map<string, Entry>();
  private readonly queue: string[] = [];
  private buildBusy = false;
  private activeRun: string | null = null;

  constructor(
    private readonly planner: Planner,
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly now: () => number = Date.now,
    /** Rejects a request at once (unknown project, bad slug, env not allowed) by throwing. */
    private readonly validate: (kind: JobKind, project: string, options: JobOptions) => void = () => {},
  ) {}

  get(id: string): Job | undefined {
    return this.jobs.get(id)?.job;
  }

  create(kind: JobKind, project: string, options?: JobOptions): Job {
    if (kind === "run" && this.activeRun) throw new ConflictError("a run is already active");
    if (kind !== "stop") this.validate(kind, project, options ?? {});
    if (kind === "stop") {
      const target = options?.runJobId ? this.jobs.get(options.runJobId) : undefined;
      if (!target || target.job.kind !== "run") throw new ConflictError("runJobId does not name a run job");
    }
    const job: Job = { id: this.newId(), kind, project, ...(options ? { options } : {}), state: "queued", exitCode: null, createdAt: this.now(), diagnostics: [] };
    this.jobs.set(job.id, { job, lines: [], listeners: new Set(), cancelRequested: false });
    this.prune();
    if (kind === "run") {
      this.activeRun = job.id;
      void this.execute(job.id);
    } else if (kind === "stop") {
      void this.stopRun(job.id, options!.runJobId!);
    } else {
      this.queue.push(job.id);
      void this.pump();
    }
    return job;
  }

  /** Lines after `afterSeq`, then live lines; `onEnd` when the job has finished. */
  subscribe(id: string, afterSeq: number, onLine: (l: LogLine) => void, onEnd: () => void): () => void {
    const e = this.jobs.get(id);
    if (!e) throw new Error("unknown job");
    for (const l of e.lines) if (l.seq > afterSeq) onLine(l);
    if (isFinal(e.job.state)) {
      onEnd();
      return () => {};
    }
    const listener = (l: LogLine | null) => (l ? onLine(l) : onEnd());
    e.listeners.add(listener);
    return () => e.listeners.delete(listener);
  }

  cancel(id: string): Job | undefined {
    const e = this.jobs.get(id);
    if (!e) return undefined;
    if (e.job.state === "queued") {
      const i = this.queue.indexOf(id);
      if (i >= 0) this.queue.splice(i, 1);
      this.finish(e, "cancelled", null, []);
    } else if (e.job.state === "running") {
      e.cancelRequested = true;
      this.terminate(e, "SIGTERM");
    }
    return e.job;
  }

  /** Lines of a job (tests, orchestrator error mapping goes through the stream). */
  lines(id: string): LogLine[] {
    return this.jobs.get(id)?.lines ?? [];
  }

  private async pump(): Promise<void> {
    if (this.buildBusy) return;
    const id = this.queue.shift();
    if (!id) return;
    this.buildBusy = true;
    try {
      await this.execute(id);
    } finally {
      this.buildBusy = false;
      void this.pump();
    }
  }

  private async execute(id: string): Promise<void> {
    const e = this.jobs.get(id)!;
    const job = e.job;
    job.state = "running";
    job.startedAt = this.now();
    let plan: Plan;
    try {
      plan = await this.planner(job.kind, job.project, job.options ?? {});
    } catch (err) {
      this.system(e, `cannot start: ${(err as Error).message}`, "error");
      this.finish(e, "failed", null, [diag("BUILD_FAILED", "build", (err as Error).message, { kind: job.kind })]);
      return;
    }
    for (const step of plan.steps) {
      if (e.cancelRequested) break;
      if (step.when && !(await step.when())) continue;
      this.system(e, `$ ${step.label}`, "info");
      const code = await this.spawn(e, step);
      if (e.cancelRequested) break;
      let problem = code === 0 ? null : `${step.label} exited with ${code}`;
      if (!problem && step.check) problem = await step.check();
      if (problem) {
        this.system(e, problem, "error");
        this.finish(e, "failed", code, [diag(plan.failCode, plan.failStage, problem, { kind: job.kind, step: step.label })]);
        return;
      }
      await step.after?.();
    }
    if (e.cancelRequested) {
      this.system(e, "cancelled", "warn");
      this.finish(e, "cancelled", null, []);
      return;
    }
    this.finish(e, "succeeded", 0, []);
  }

  private spawn(e: Entry, step: Step): Promise<number> {
    return new Promise((resolve) => {
      // setsid: the command leads its own process group, so cancel/stop reaches every child.
      const proc = Bun.spawn(["setsid", ...step.argv], {
        cwd: step.cwd,
        env: { ...process.env, ...(step.env ?? {}) },
        stdout: "pipe",
        stderr: "pipe",
      });
      e.proc = proc;
      const pump = async (stream: ReadableStream<Uint8Array>, name: "stdout" | "stderr") => {
        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of stream) {
          buf += decoder.decode(chunk, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            this.output(e, name, buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            nl = buf.indexOf("\n");
          }
        }
        if (buf) this.output(e, name, buf);
      };
      Promise.all([pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr"), proc.exited]).then(([, , code]) => {
        e.proc = undefined;
        resolve(code);
      });
    });
  }

  private async stopRun(stopId: string, runId: string): Promise<void> {
    const stop = this.jobs.get(stopId)!;
    const run = this.jobs.get(runId)!;
    stop.job.state = "running";
    stop.job.startedAt = this.now();
    if (run.job.state === "running") {
      run.cancelRequested = true;
      this.system(run, "stop requested (SIGINT, SIGKILL after 5 s)", "info");
      this.terminate(run, "SIGINT");
      const killer = setTimeout(() => this.terminate(run, "SIGKILL"), 5_000);
      await new Promise<void>((r) => {
        if (isFinal(run.job.state)) r();
        else run.listeners.add((l) => l === null && r());
      });
      clearTimeout(killer);
    } else if (run.job.state === "queued") this.cancel(runId);
    this.finish(stop, "succeeded", 0, []);
  }

  private terminate(e: Entry, signal: NodeJS.Signals) {
    const pid = e.proc?.pid;
    if (!pid) return;
    try {
      process.kill(-pid, signal);
    } catch {
      e.proc?.kill(signal);
    }
  }

  private output(e: Entry, stream: "stdout" | "stderr", raw: string) {
    const msg = raw.replace(ANSI, "").replace(/\r$/, "");
    const level = /\berror\b|FAILED|fatal/i.test(msg) ? "error" : /\bwarning\b/i.test(msg) ? "warn" : "info";
    this.push(e, { runId: e.job.id, seq: e.lines.length, ts: this.now(), stream, level, msg, ...(raw !== msg ? { raw } : {}) });
  }

  private system(e: Entry, msg: string, level: LogLine["level"]) {
    this.push(e, { runId: e.job.id, seq: e.lines.length, ts: this.now(), stream: "system", level, msg });
  }

  private push(e: Entry, l: LogLine) {
    if (e.lines.length >= MAX_LINES) return; // the job log is capped; the job result still arrives
    e.lines.push(l);
    for (const f of e.listeners) f(l);
  }

  private finish(e: Entry, state: JobState, exitCode: number | null, diagnostics: Diagnostic[]) {
    if (isFinal(e.job.state)) return;
    this.system(e, `job ${state}`, state === "succeeded" ? "info" : state === "cancelled" ? "warn" : "error");
    e.job.state = state;
    e.job.exitCode = exitCode;
    e.job.finishedAt = this.now();
    e.job.diagnostics = diagnostics;
    if (this.activeRun === e.job.id) this.activeRun = null;
    for (const f of [...e.listeners]) f(null);
    e.listeners.clear();
  }

  private prune() {
    if (this.jobs.size <= MAX_JOBS) return;
    for (const [id, e] of this.jobs) {
      if (this.jobs.size <= MAX_JOBS) break;
      if (isFinal(e.job.state)) this.jobs.delete(id);
    }
  }
}

const isFinal = (s: JobState) => s === "succeeded" || s === "failed" || s === "cancelled";

export function diag(code: string, stage: string, message: string, data?: Record<string, unknown>): Diagnostic {
  return { code, severity: "error", stage, message, docs: `diagnostics#${code}`, ...(data ? { data } : {}) };
}

export const isBuildKind = (k: JobKind) => BUILD_KINDS.has(k);
