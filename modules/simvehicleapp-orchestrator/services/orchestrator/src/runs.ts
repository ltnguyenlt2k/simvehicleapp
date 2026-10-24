import type { Clients, Diagnostic, ToolchainJob } from "./clients.ts";
import { type EventHub, itemOfRunEvent } from "./events.ts";
import { ACTIVE_RUN_STATES, type Project, type Repo, type Run, type RunEvent } from "./repo.ts";
import { TraceIngest } from "./trace.ts";

/**
 * RunManager (ADR-0027 §1, analysis/08 §5, M08-T03): one live run at a time on the shared runtime
 * stack — or, with sandboxes (ADR-0057, M17-T04), many runs each on a databroker of its own, within quotas and a
 * time limit. A run starts the app the project's latest successful generation built (toolchain `run` job,
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

/** Run quota reached (ADR-0057): 409 with `RUN_QUOTA_EXCEEDED`; `own` lists the caller's runs that hold it. */
export class RunQuota extends Error {
  constructor(
    readonly diagnostic: Diagnostic,
    readonly own: Run[],
  ) {
    super(diagnostic.message);
  }
}

/** Run limits (ADR-0057): with sandboxes, quotas replace the one-run lock. */
export interface RunLimits {
  /** Every run gets a databroker of its own (`SV_RUN_SANDBOX=1`). */
  sandbox: boolean;
  perUser: number;
  total: number;
  /** A run stops by itself this long after it started (`SV_RUN_MAX_MINUTES`; 0 = never). */
  maxMinutes: number;
  maxExtensions: number;
}

/** The databroker API of a backend's apps: its entry, else `*`, else `sdv.databroker.v1` (ADR-0047 §3–4). */
export function databrokerApiOf(apis: Record<string, string> | undefined, language: string): "sdv.databroker.v1" | "kuksa.val.v2" {
  return (apis?.[language] ?? apis?.["*"]) === "kuksa.val.v2" ? "kuksa.val.v2" : "sdv.databroker.v1";
}

export function runLimitsFromEnv(env: Record<string, string | undefined> = process.env): RunLimits {
  const int = (name: string, fallback: number, min = 0) => {
    const v = Number(env[name]);
    return env[name] !== undefined && env[name] !== "" && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
  };
  return {
    sandbox: env.SV_RUN_SANDBOX === "1",
    perUser: int("SV_MAX_RUNS_PER_USER", 2, 1),
    total: int("SV_MAX_RUNS_TOTAL", 20, 1),
    // Fractions allowed (a gate runs with 0.75 = 45 s).
    maxMinutes: env.SV_RUN_MAX_MINUTES !== undefined && env.SV_RUN_MAX_MINUTES !== "" && Number(env.SV_RUN_MAX_MINUTES) >= 0 ? Number(env.SV_RUN_MAX_MINUTES) : 30,
    maxExtensions: int("SV_RUN_MAX_EXTENSIONS", 3),
  };
}

export interface RunDeps {
  repo: Repo;
  clients: Clients;
  hub: EventHub;
  /** VSS release ⇒ databroker `host:port` (SV_DATABROKERS, ADR-0024 §6). */
  databrokers: Record<string, string>;
  /** Databroker API of each backend's apps (`SV_DATABROKER_API`, ADR-0047 §3): `kuksa.val.v2` or the default `sdv.databroker.v1`. */
  databrokerApis?: Record<string, string>;
  newId?: () => string;
  now?: () => number;
  startTimeoutMs?: number;
  batchMs?: number;
  log?: { info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void };
  /** Without it: one run at a time on the shared databrokers, no expiry (the v1 behaviour). */
  limits?: RunLimits;
  /** Deployments (ADR-0060): how many may be active per workspace (`SV_MAX_DEPLOYMENTS_PER_WORKSPACE`, default 2). */
  deployLimits?: { perWorkspace: number };
  /** Observability hooks (ADR-0033 §2): runs ended by state, trace events stored. */
  metrics?: { runEnded(state: "stopped" | "crashed", code?: string): void; traceEvents(count: number): void };
}

const LEVELS = ["off", "trigger", "node"] as const;
const diag = (code: string, message: string, data?: Record<string, unknown>): Diagnostic => ({ code, severity: "error", stage: "run", message, docs: `diagnostics#${code}`, ...(data ? { data } : {}) });

interface Live {
  ingest: TraceIngest;
  stopRequested: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** Stops the run when it expires. */
  expiry?: ReturnType<typeof setTimeout>;
}

/** A deploy target as a deployment needs it: where, how, with the token already opened. */
export interface DeployTargetRef {
  id: string;
  name: string;
  address: string;
  tls: boolean;
  token?: string;
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

  /** The generation a run or deployment starts: the project's latest, passed SynCode. */
  private async checkGeneration(project: Project, generationId: string) {
    const latest = await this.d.repo.latestGeneration(project.id);
    const gen = await this.d.repo.generation(generationId);
    if (!gen || gen.projectId !== project.id) throw new RunConflict("unknown generation");
    if (latest && (latest.state === "queued" || latest.state === "running")) throw new RunConflict("A SynCode of this project is in progress: run when it has finished");
    if (gen.state !== "succeeded") throw new RunConflict("Only a generation that passed SynCode can run");
    if (latest?.id !== gen.id) throw new RunConflict("The project changed since this generation: run its latest SynCode");
    return gen;
  }

  async start(project: Project, generationId: string, traceLevel?: Run["traceLevel"], owner?: Run["owner"]): Promise<Run> {
    const gen = await this.checkGeneration(project, generationId);
    const sandbox = this.d.limits?.sandbox === true;
    // Deployments use neither the shared databrokers nor the run quota (ADR-0060).
    const active = (await this.d.repo.runs({ active: true, limit: 1000 })).filter((r) => !r.deploy);
    const own = active.find((r) => r.projectId === project.id);
    if (own) throw new RunConflict(`${project.name} is already running: stop it or restart it`, own);
    if (!sandbox) {
      // Shared databrokers: two apps would read and write the same signals.
      if (active[0]) throw new RunConflict("Another run is active: stop it first", active[0]);
    } else {
      const l = this.d.limits!;
      if (active.length >= l.total) throw new RunQuota(diag("RUN_QUOTA_EXCEEDED", `${active.length} apps are running on this host: the limit is ${l.total}. Stop a run or try again later.`, { scope: "host", limit: l.total }), []);
      const mine = owner ? active.filter((r) => r.owner?.userId === owner.userId) : [];
      if (owner && mine.length >= l.perUser) throw new RunQuota(diag("RUN_QUOTA_EXCEEDED", `You already have ${mine.length} apps running: the limit is ${l.perUser}. Stop one of them first.`, { scope: "user", limit: l.perUser }), mine);
    }
    const broker = sandbox ? "a databroker of its own" : this.d.databrokers[project.vssRelease];
    if (!broker) throw new RunConflict(`The stack has no databroker for VSS ${project.vssRelease}`);

    const projectLevel = project.settings.traceLevel;
    const level = traceLevel && LEVELS.indexOf(traceLevel) < LEVELS.indexOf(projectLevel) ? traceLevel : projectLevel;
    const run: Run = { id: (this.d.newId ?? (() => `r_${crypto.randomUUID()}`))(), projectId: project.id, generationId, state: "starting", vssRelease: project.vssRelease, traceLevel: level, diagnostics: [], createdAt: this.now(), ...(owner ? { owner } : {}) };
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
    // A v2 app actuates through a provider: the gateway provides its actuators instead of mirroring targets (ADR-0047 §2).
    // SV_DATABROKER_API selects the host of the Rust runtime, KUKSA_DATABROKER_API the client of the C++ SDK 0.7.1.
    const api = databrokerApiOf(this.d.databrokerApis, project.language);
    if (!sandbox) {
      await this.d.clients.mirror(project.vssRelease, writes, undefined, api).catch((e) => ingest.system(`signal mirroring is unavailable: ${(e as Error).message}`, "warn"));
    }

    const job = await this.d.clients.startJob(
      project.language,
      "run",
      project.slug,
      sandbox
        ? { sandbox: true, env: { SV_TRACE_LEVEL: level, SV_RUN_ID: run.id, SV_DATABROKER_API: api, KUKSA_DATABROKER_API: api } }
        : { env: { SDV_VEHICLEDATABROKER_ADDRESS: `grpc://${broker}`, SV_TRACE_LEVEL: level, SV_RUN_ID: run.id, SV_DATABROKER_API: api, KUKSA_DATABROKER_API: api } },
    );
    if (!job.ok) {
      const d = job.diagnostics.length ? job.diagnostics : [diag("RUN_CRASHED", `The toolchain refused the run (${job.status}${job.message ? `: ${job.message}` : ""})`)];
      await this.finish(run.id, "crashed", d);
      return (await this.d.repo.run(run.id))!;
    }
    await this.d.repo.updateRun(run.id, { jobId: job.value.id });
    if (sandbox) {
      // Where the run's databroker listens (the agent starts it before the app): the signal-gateway mirrors there and
      // the studio's Signals, inject and Play reach it (M17-T05).
      const address = await this.sandboxAddress(project.language, job.value.id);
      if (address) {
        await this.d.repo.updateRun(run.id, { sandbox: address });
        ingest.system(`vehicle sandbox: this run's databroker is ${address}`);
        await this.d.clients.mirror(project.vssRelease, writes, address, api).catch((e) => ingest.system(`signal mirroring is unavailable: ${(e as Error).message}`, "warn"));
      } else ingest.system("the run's databroker did not report its address: Signals show the shared databroker", "warn");
    }
    live.timer = setTimeout(() => void this.timeout(run.id), this.d.startTimeoutMs ?? 30_000);
    void this.follow(project, run.id, job.value.id);
    return (await this.d.repo.run(run.id))!;
  }

  /**
   * Deploys the app to a target (ADR-0060): it runs like a Run, but its databroker is a vehicle-gateway route to the
   * target's databroker — signals come from the target's layers; it writes only in read-write mode, only its own
   * actuators. No mirror (the target has its providers), no expiry; a quota per workspace.
   */
  async startDeployment(project: Project, generationId: string, target: DeployTargetRef, mode: "read-only" | "read-write", owner?: Run["owner"]): Promise<Run> {
    const gen = await this.checkGeneration(project, generationId);
    const deployments = (await this.d.repo.runs({ active: true, limit: 1000 })).filter((r) => r.deploy);
    const own = deployments.find((r) => r.projectId === project.id);
    if (own) throw new RunConflict(`${project.name} is already deployed to ${own.deploy!.targetName}: stop that deployment first`, own);
    const perWorkspace = this.d.deployLimits?.perWorkspace ?? 2;
    const workspace = owner?.workspaceId;
    const ofWorkspace = workspace ? deployments.filter((r) => r.owner?.workspaceId === workspace) : [];
    if (workspace && ofWorkspace.length >= perWorkspace)
      throw new RunQuota(diag("DEPLOY_QUOTA_EXCEEDED", `This workspace has ${ofWorkspace.length} deployments: the limit is ${perWorkspace}. Stop one of them first.`, { scope: "workspace", limit: perWorkspace }), ofWorkspace);

    const level = project.settings.traceLevel;
    const run: Run = {
      id: (this.d.newId ?? (() => `r_${crypto.randomUUID()}`))(),
      projectId: project.id,
      generationId,
      state: "starting",
      vssRelease: project.vssRelease,
      traceLevel: level,
      diagnostics: [],
      createdAt: this.now(),
      ...(owner ? { owner } : {}),
      deploy: { targetId: target.id, targetName: target.name, mode },
    };
    await this.d.repo.createRun(run);
    const { live, ingest } = this.track(run, gen);
    const actuators = (gen.runInfo?.signals ?? []).filter((s) => s.vssType === "actuator" && s.access.includes("write")).map((s) => s.path);
    let address: string;
    try {
      ({ address } = await this.d.clients.openRoute(run.id, { target: target.address, tls: target.tls, ...(target.token ? { token: target.token } : {}), mode, actuators }));
    } catch (e) {
      await this.finish(run.id, "crashed", [diag("DEPLOY_TARGET_UNREACHABLE", `No route to ${target.name}: ${(e as Error).message}`)]);
      return (await this.d.repo.run(run.id))!;
    }
    await this.d.repo.updateRun(run.id, { sandbox: address });
    ingest.system(`▶ deploy ${project.slug} (generation ${generationId}, VSS ${project.vssRelease}) to ${target.name} (${target.address}${target.tls ? ", TLS" : ""}), ${mode}, through ${address}`);
    const api = databrokerApiOf(this.d.databrokerApis, project.language);
    const job = await this.d.clients.startJob(project.language, "run", project.slug, {
      env: { SDV_VEHICLEDATABROKER_ADDRESS: `grpc://${address}`, SV_TRACE_LEVEL: level, SV_RUN_ID: run.id, SV_DATABROKER_API: api, KUKSA_DATABROKER_API: api },
    });
    if (!job.ok) {
      const d = job.diagnostics.length ? job.diagnostics : [diag("RUN_CRASHED", `The toolchain refused the deployment (${job.status}${job.message ? `: ${job.message}` : ""})`)];
      await this.finish(run.id, "crashed", d);
      return (await this.d.repo.run(run.id))!;
    }
    await this.d.repo.updateRun(run.id, { jobId: job.value.id });
    live.timer = setTimeout(() => void this.timeout(run.id), this.d.startTimeoutMs ?? 30_000);
    void this.follow(project, run.id, job.value.id);
    return (await this.d.repo.run(run.id))!;
  }

  /** The live state of a run: its trace ingest (SSE), the lifecycle hooks. */
  private track(run: Run, gen: { runInfo?: { traceMap?: Record<string, unknown> } }) {
    const ingest = new TraceIngest({
      runId: run.id,
      traceMap: (gen.runInfo?.traceMap ?? {}) as never,
      batchMs: this.d.batchMs,
      now: this.now,
      emit: (events) => this.emit(run.id, events),
      onLifecycle: (ev) => {
        if (ev === "app.started") void this.started(run.id);
      },
    });
    const live: Live = { ingest, stopRequested: false };
    this.live.set(run.id, live);
    return { live, ingest };
  }

  async stop(runId: string, reason: NonNullable<Run["stopReason"]> = "user"): Promise<Run | null> {
    const run = await this.d.repo.run(runId);
    if (!run) return null;
    if (!ACTIVE_RUN_STATES.includes(run.state) || run.state === "stopping") return run;
    const live = this.live.get(runId);
    if (live) live.stopRequested = true;
    if (live?.expiry) clearTimeout(live.expiry);
    await this.d.repo.updateRun(runId, { state: "stopping", stopReason: reason });
    live?.ingest.system(reason === "expired" ? "■ the run reached its time limit: stopping (Extend keeps it running)" : "■ stop requested (SIGINT, SIGKILL after 5 s)");
    const project = await this.d.repo.project(run.projectId);
    if (run.jobId && project) {
      const stop = await this.d.clients.startJob(project.language, "stop", project.slug, { runJobId: run.jobId }).catch(() => null);
      if (!stop?.ok && !live) await this.finish(runId, "stopped", []);
    } else await this.finish(runId, "stopped", []);
    return this.d.repo.run(runId);
  }

  /**
   * Keeps a running app `maxMinutes` longer (ADR-0057), at most `maxExtensions` times; RunConflict when it is not
   * running, has no time limit or was extended enough.
   */
  async extend(runId: string): Promise<Run | null> {
    const run = await this.d.repo.run(runId);
    if (!run) return null;
    const l = this.d.limits;
    if (run.state !== "running" || !run.expiresAt || !l || l.maxMinutes <= 0) throw new RunConflict("Only a running app with a time limit can be extended", run);
    if ((run.extensions ?? 0) >= l.maxExtensions) throw new RunConflict(`This run was already extended ${l.maxExtensions} times: start it again to run longer`, run);
    const expiresAt = run.expiresAt + l.maxMinutes * 60_000;
    await this.d.repo.updateRun(runId, { expiresAt, extensions: (run.extensions ?? 0) + 1 });
    this.schedule(runId, expiresAt);
    this.live.get(runId)?.ingest.system(`⏱ extended until ${new Date(expiresAt).toISOString()}`);
    return this.d.repo.run(runId);
  }

  /** The sandbox address of a run job, polled for up to 5 s (a broker is ready in tens of ms). */
  private async sandboxAddress(language: string, jobId: string): Promise<string | undefined> {
    for (let waited = 0; waited <= 5_000; waited += 25) {
      const job = await this.d.clients.getJob(language, jobId).catch(() => null);
      if (job?.sandbox) return job.sandbox.address;
      if (!job || !["queued", "running"].includes(job.state)) return undefined;
      await Bun.sleep(25);
    }
    return undefined;
  }

  private schedule(runId: string, expiresAt: number) {
    const live = this.live.get(runId);
    if (!live) return;
    if (live.expiry) clearTimeout(live.expiry);
    live.expiry = setTimeout(() => void this.stop(runId, "expired"), Math.max(0, expiresAt - this.now()));
  }

  /** The run limits in force; without sandboxes one run at a time and no expiry. */
  get limits(): RunLimits {
    return this.d.limits ?? { sandbox: false, perUser: 1, total: 1, maxMinutes: 0, maxExtensions: 0 };
  }

  /** Runs starting, running or stopping in this process. */
  get activeCount(): number {
    return this.live.size;
  }

  private emit(runId: string, events: RunEvent[]) {
    const traces = events.filter((e) => e.kind === "trace").length;
    if (traces) this.d.metrics?.traceEvents(traces);
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
    const runningAt = this.now();
    const l = this.d.limits;
    const expiresAt = l && l.maxMinutes > 0 && !run.deploy ? runningAt + l.maxMinutes * 60_000 : undefined;
    await this.d.repo.updateRun(runId, { state: "running", runningAt, ...(expiresAt ? { expiresAt } : {}) });
    if (expiresAt) this.schedule(runId, expiresAt);
    this.d.log?.info("run started", { run: runId, ...(run.sandbox ? { sandbox: run.sandbox } : {}) });
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
    if (live?.expiry) clearTimeout(live.expiry);
    live?.ingest.flush();
    // Every batch is stored before the run is marked finished (a late subscriber reads them all).
    await this.chains.get(runId);
    const run = await this.d.repo.run(runId);
    if (!run) return;
    this.d.metrics?.runEnded(state, diagnostics[0]?.code);
    // Release the mirror/provider before the run is seen finished: a run started right after (gates, Stop and run)
    // claims the same actuators, and a late release would wipe its claim.
    await this.d.clients.mirror(run.vssRelease, [], run.sandbox).catch(() => {});
    if (run.deploy) await this.d.clients.closeRoute(run.id).catch((e) => this.d.log?.warn("deployment route not closed", { run: runId, err: (e as Error).message }));
    await this.d.repo.updateRun(runId, { state, finishedAt: this.now(), ...(diagnostics.length ? { diagnostics: [...run.diagnostics, ...diagnostics] } : {}), ...(exitCode !== undefined ? { exitCode } : {}) });
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
