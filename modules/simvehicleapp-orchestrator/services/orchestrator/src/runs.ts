import type { Clients, Diagnostic, ToolchainJob } from "./clients.ts";
import { type EventHub, itemOfRunEvent } from "./events.ts";
import { ACTIVE_RUN_STATES, type Project, type Repo, type Run, type RunEvent } from "./repo.ts";
import { TraceIngest } from "./trace.ts";

/**
 * RunManager (ADR-0027 §1, analysis/08 §5, M08-T03): one live run at a time on the shared runtime
 * stack. A run starts the app the project's latest successful generation built (toolchain `run` job,
 * databroker of the project's VSS release), is `running` once the app traces `app.started` (else
 * RUN_START_TIMEOUT after 30 s), and ends `stopped` after Stop (SIGINT, SIGKILL after 5 s) or `crashed`.
 * Actuators the app writes are mirrored target → current by the signal-gateway while it runs.
 */

export class RunConflict extends Error {
  constructor(
    message: string,
    readonly activeRun?: Run,
  ) {
    super(message);
  }
}

export interface RunDeps {
  repo: Repo;
  clients: Clients;
  hub: EventHub;
  /** VSS release ⇒ databroker `host:port` (SV_DATABROKERS, ADR-0024 §6). */
  databrokers: Record<string, string>;
  newId?: () => string;
  now?: () => number;
  startTimeoutMs?: number;
  batchMs?: number;
  log?: { info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void };
}

const LEVELS = ["off", "trigger", "node"] as const;
const diag = (code: string, message: string, data?: Record<string, unknown>): Diagnostic => ({ code, severity: "error", stage: "run", message, docs: `diagnostics#${code}`, ...(data ? { data } : {}) });

interface Live {
  ingest: TraceIngest;
  stopRequested: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class RunManager {
  private readonly live = new Map<string, Live>();
  /** Per run: batches are stored, then published, in order (a late subscriber finds every event). */
  private readonly chains = new Map<string, Promise<void>>();
  private readonly now: () => number;

  constructor(private readonly d: RunDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Runs left active by a previous orchestrator process are stopped (their app may still run). */
  async recover(): Promise<number> {
    const stale = await this.d.repo.runs({ active: true, limit: 100 });
    for (const r of stale) {
      const project = await this.d.repo.project(r.projectId);
      if (r.jobId && project) await this.d.clients.startJob(project.language, "stop", project.slug, { runJobId: r.jobId }).catch(() => null);
      await this.d.repo.updateRun(r.id, { state: "stopped", finishedAt: this.now(), diagnostics: [...r.diagnostics, diag("RUN_CRASHED", "The orchestrator restarted during this run; the app was stopped")] });
    }
    return stale.length;
  }

  async start(project: Project, generationId: string, traceLevel?: Run["traceLevel"]): Promise<Run> {
    const latest = await this.d.repo.latestGeneration(project.id);
    const gen = await this.d.repo.generation(generationId);
    if (!gen || gen.projectId !== project.id) throw new RunConflict("unknown generation");
    if (latest && (latest.state === "queued" || latest.state === "running")) throw new RunConflict("A SynCode of this project is in progress: run when it has finished");
    if (gen.state !== "succeeded") throw new RunConflict("Only a generation that passed SynCode can run");
    if (latest?.id !== gen.id) throw new RunConflict("The project changed since this generation: run its latest SynCode");
    const [active] = await this.d.repo.runs({ active: true, limit: 1 });
    if (active) throw new RunConflict("Another run is active: stop it first", active);
    const broker = this.d.databrokers[project.vssRelease];
    if (!broker) throw new RunConflict(`The stack has no databroker for VSS ${project.vssRelease}`);

    const projectLevel = project.settings.traceLevel;
    const level = traceLevel && LEVELS.indexOf(traceLevel) < LEVELS.indexOf(projectLevel) ? traceLevel : projectLevel;
    const run: Run = { id: (this.d.newId ?? (() => `r_${crypto.randomUUID()}`))(), projectId: project.id, generationId, state: "starting", vssRelease: project.vssRelease, traceLevel: level, diagnostics: [], createdAt: this.now() };
    await this.d.repo.createRun(run);

    const ingest = new TraceIngest({
      runId: run.id,
      traceMap: gen.runInfo?.traceMap ?? {},
      batchMs: this.d.batchMs,
      now: this.now,
      emit: (events) => this.emit(run.id, events),
      onLifecycle: (ev) => {
        if (ev === "app.started") void this.started(run.id);
      },
    });
    const live: Live = { ingest, stopRequested: false };
    this.live.set(run.id, live);
    ingest.system(`▶ run ${project.slug} (generation ${generationId}, VSS ${project.vssRelease} on ${broker}, trace ${level})`);

    const writes = (gen.runInfo?.signals ?? []).filter((s) => s.vssType === "actuator" && s.access.includes("write")).map((s) => s.path);
    await this.d.clients.mirror(project.vssRelease, writes).catch((e) => ingest.system(`signal mirroring is unavailable: ${(e as Error).message}`, "warn"));

    const job = await this.d.clients.startJob(project.language, "run", project.slug, {
      env: { SDV_VEHICLEDATABROKER_ADDRESS: `grpc://${broker}`, SV_TRACE_LEVEL: level, SV_RUN_ID: run.id },
    });
    if (!job.ok) {
      const d = job.diagnostics.length ? job.diagnostics : [diag("RUN_CRASHED", `The toolchain refused the run (${job.status}${job.message ? `: ${job.message}` : ""})`)];
      await this.finish(run.id, "crashed", d);
      return (await this.d.repo.run(run.id))!;
    }
    await this.d.repo.updateRun(run.id, { jobId: job.value.id });
    live.timer = setTimeout(() => void this.timeout(run.id), this.d.startTimeoutMs ?? 30_000);
    void this.follow(project, run.id, job.value.id);
    return (await this.d.repo.run(run.id))!;
  }

  async stop(runId: string): Promise<Run | null> {
    const run = await this.d.repo.run(runId);
    if (!run) return null;
    if (!ACTIVE_RUN_STATES.includes(run.state) || run.state === "stopping") return run;
    const live = this.live.get(runId);
    if (live) live.stopRequested = true;
    await this.d.repo.updateRun(runId, { state: "stopping" });
    live?.ingest.system("■ stop requested (SIGINT, SIGKILL after 5 s)");
    const project = await this.d.repo.project(run.projectId);
    if (run.jobId && project) {
      const stop = await this.d.clients.startJob(project.language, "stop", project.slug, { runJobId: run.jobId }).catch(() => null);
      if (!stop?.ok && !live) await this.finish(runId, "stopped", []);
    } else await this.finish(runId, "stopped", []);
    return this.d.repo.run(runId);
  }

  private emit(runId: string, events: RunEvent[]) {
    const prev = this.chains.get(runId) ?? Promise.resolve();
    this.chains.set(
      runId,
      prev.then(async () => {
        await this.d.repo.appendRunEvents(runId, events).catch((e) => this.d.log?.warn("run events not stored", { run: runId, err: (e as Error).message }));
        this.d.hub.publish(runId, events.map(itemOfRunEvent));
      }),
    );
  }

  private async started(runId: string) {
    const run = await this.d.repo.run(runId);
    if (run?.state !== "starting") return;
    const live = this.live.get(runId);
    if (live?.timer) clearTimeout(live.timer);
    await this.d.repo.updateRun(runId, { state: "running", runningAt: this.now() });
    this.d.log?.info("run started", { run: runId });
  }

  private async timeout(runId: string) {
    const run = await this.d.repo.run(runId);
    if (run?.state !== "starting") return;
    const live = this.live.get(runId);
    live?.ingest.system("✘ the app did not start within 30 s (no app.started)", "error");
    await this.d.repo.updateRun(runId, { diagnostics: [diag("RUN_START_TIMEOUT", "The app did not report app.started within 30 s")] });
    if (live) live.stopRequested = true;
    const project = await this.d.repo.project(run.projectId);
    if (run.jobId && project) await this.d.clients.startJob(project.language, "stop", project.slug, { runJobId: run.jobId }).catch(() => null);
  }

  private async follow(project: Project, runId: string, jobId: string) {
    const live = this.live.get(runId)!;
    let job: ToolchainJob | null = null;
    try {
      job = await this.d.clients.followJob(project.language, jobId, -1, (l) => {
        if (l.stream === "system" && /^job (succeeded|failed|cancelled)$/.test(l.msg)) return;
        live.ingest.line(l);
      });
    } catch (e) {
      live.ingest.system(`lost the app's log: ${(e as Error).message}`, "error");
    }
    const run = await this.d.repo.run(runId);
    if (!run) return;
    const timedOut = run.diagnostics.some((x) => (x as Diagnostic).code === "RUN_START_TIMEOUT");
    if (live.stopRequested && !timedOut) {
      live.ingest.system(`■ stopped${job?.exitCode !== null && job?.exitCode !== undefined ? ` (exit ${job.exitCode})` : ""}`);
      await this.finish(runId, "stopped", [], job?.exitCode ?? undefined);
    } else {
      const code = job?.exitCode;
      const d: Diagnostic[] = timedOut ? (run.diagnostics as Diagnostic[]) : [diag("RUN_CRASHED", `The app exited${code !== null && code !== undefined ? ` with ${code}` : ""}${run.state === "starting" ? " before it started" : ""}`, { exitCode: code ?? null })];
      live.ingest.system(`✘ ${d[0]?.message ?? "the app ended"}`, "error");
      await this.finish(runId, "crashed", timedOut ? [] : d, code ?? undefined);
    }
  }

  private async finish(runId: string, state: "stopped" | "crashed", diagnostics: Diagnostic[], exitCode?: number) {
    const live = this.live.get(runId);
    if (live?.timer) clearTimeout(live.timer);
    live?.ingest.flush();
    // Every batch is stored before the run is marked finished (a late subscriber reads them all).
    await this.chains.get(runId);
    const run = await this.d.repo.run(runId);
    if (!run) return;
    await this.d.repo.updateRun(runId, { state, finishedAt: this.now(), ...(diagnostics.length ? { diagnostics: [...run.diagnostics, ...diagnostics] } : {}), ...(exitCode !== undefined ? { exitCode } : {}) });
    await this.d.clients.mirror(run.vssRelease, []).catch(() => {});
    this.live.delete(runId);
    this.chains.delete(runId);
    this.d.hub.end(runId);
    this.d.log?.info("run ended", { run: runId, state });
  }

  /** Stored events of a run (SSE backlog). */
  events(runId: string, afterSeq: number) {
    return this.d.repo.runEvents(runId, afterSeq);
  }
}
