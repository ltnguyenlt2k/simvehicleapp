import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SQL } from "bun";

/**
 * Data of the orchestrator (schema `sv`, ADR-0007 §4): projects, the workflows assigned to them,
 * generations (also the SynCode job queue: `FOR UPDATE SKIP LOCKED`) and the log of each generation
 * (SSE resume). `PgRepo` is the service's store; `MemoryRepo` runs the pipeline in tests.
 */

export type Verdict = "passed" | "failed" | "skipped" | "pending";
export type Stage = "ir" | "codegen" | "write" | "deps" | "build" | "format-check" | "test";
export type GenState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface ProjectSettings {
  mqttTopicPrefix: string;
  traceLevel: "off" | "trigger" | "node";
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  appName: string;
  language: "cpp" | "python" | "rust";
  vssRelease: string;
  settings: ProjectSettings;
  status: "creating" | "ready" | "failed";
  statusMessage?: string;
  depsInstalled: boolean;
  workflows: { simWorkflowId: string; enabled: boolean }[];
}

export interface StageInfo {
  name: Stage;
  state: "pending" | "running" | "passed" | "failed" | "skipped";
  startedAt?: number;
  finishedAt?: number;
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

/** What a run needs from its generation (M8): node → block of every workflow, signals of the app. */
export interface RunInfo {
  traceMap: Record<string, Record<string, string>>;
  signals: { path: string; vssType: string; dataType: string; access: string[] }[];
}

export interface Generation {
  id: string;
  projectId: string;
  state: GenState;
  stage?: Stage;
  stages: StageInfo[];
  verification: { ir: Verdict; format: Verdict; compile: Verdict; tests: Verdict };
  diagnostics: unknown[];
  generatedFiles: string[];
  workflows: { workflowId: string; revision: number; irHash: string }[];
  backend?: string;
  compilerVersion?: string;
  modelHash?: string;
  runInfo?: RunInfo;
  request: GenerationRequest;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export interface GenerationRequest {
  graphs: Record<string, unknown>[];
  scenarios?: { workflowId: string; scenario: Record<string, unknown> }[];
  overwriteModified?: boolean;
}

export type RunState = "starting" | "running" | "stopping" | "stopped" | "crashed";
export const ACTIVE_RUN_STATES: readonly RunState[] = ["starting", "running", "stopping"];

export interface Run {
  id: string;
  projectId: string;
  generationId: string;
  state: RunState;
  vssRelease: string;
  traceLevel: ProjectSettings["traceLevel"];
  jobId?: string;
  exitCode?: number;
  diagnostics: unknown[];
  createdAt: number;
  runningAt?: number;
  finishedAt?: number;
}

/** TraceEvent v1 (contracts trace-event). */
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

/** One event of a run's stream: a log line or a trace event, sharing one seq space (SSE resume). */
export type RunEvent = { kind: "log"; seq: number; body: LogLine } | { kind: "trace"; seq: number; body: TraceEvent };

export interface Repo {
  migrate(): Promise<void>;
  createProject(p: Omit<Project, "workflows" | "depsInstalled">): Promise<Project>;
  project(idOrSlug: string): Promise<Project | null>;
  projects(): Promise<Project[]>;
  updateProject(id: string, patch: Partial<Pick<Project, "status" | "statusMessage" | "depsInstalled">>): Promise<void>;
  setWorkflows(id: string, workflows: Project["workflows"]): Promise<void>;
  createGeneration(g: Generation): Promise<Generation>;
  generation(id: string): Promise<Generation | null>;
  /** The oldest queued generation, now `running` (one worker claims it). */
  claimGeneration(): Promise<Generation | null>;
  updateGeneration(id: string, patch: Partial<Omit<Generation, "id" | "projectId" | "request" | "createdAt">>): Promise<void>;
  /** Generations a crashed process left running go back to the queue. */
  requeueRunning(): Promise<number>;
  appendEvent(generationId: string, line: LogLine): Promise<void>;
  events(generationId: string, afterSeq: number): Promise<LogLine[]>;
  /** The most recent generation of a project (any state). */
  latestGeneration(projectId: string): Promise<Generation | null>;
  createRun(r: Run): Promise<Run>;
  run(id: string): Promise<Run | null>;
  /** Most recent first. */
  runs(filter: { projectId?: string; active?: boolean; limit?: number }): Promise<Run[]>;
  updateRun(id: string, patch: Partial<Omit<Run, "id" | "projectId" | "generationId" | "createdAt">>): Promise<void>;
  appendRunEvents(runId: string, events: RunEvent[]): Promise<void>;
  runEvents(runId: string, afterSeq: number, limit?: number): Promise<RunEvent[]>;
}

export const initialVerification = (): Generation["verification"] => ({ ir: "pending", format: "pending", compile: "pending", tests: "pending" });
export const STAGES: Stage[] = ["ir", "codegen", "write", "deps", "build", "format-check", "test"];

// ---- in memory (tests) ------------------------------------------------------------------------------

export class MemoryRepo implements Repo {
  readonly projectsById = new Map<string, Project>();
  readonly gens = new Map<string, Generation>();
  readonly logs = new Map<string, LogLine[]>();
  async migrate() {}
  async createProject(p: Omit<Project, "workflows" | "depsInstalled">) {
    if ([...this.projectsById.values()].some((x) => x.slug === p.slug)) throw new DuplicateSlug(p.slug);
    const full: Project = { ...p, depsInstalled: false, workflows: [] };
    this.projectsById.set(p.id, full);
    return structuredClone(full);
  }
  async project(k: string) {
    const p = this.projectsById.get(k) ?? [...this.projectsById.values()].find((x) => x.slug === k);
    return p ? structuredClone(p) : null;
  }
  async projects() {
    return [...this.projectsById.values()].map((p) => structuredClone(p));
  }
  async updateProject(id: string, patch: Partial<Project>) {
    Object.assign(this.projectsById.get(id)!, patch);
  }
  async setWorkflows(id: string, workflows: Project["workflows"]) {
    this.projectsById.get(id)!.workflows = structuredClone(workflows);
  }
  async createGeneration(g: Generation) {
    this.gens.set(g.id, structuredClone(g));
    return g;
  }
  async generation(id: string) {
    const g = this.gens.get(id);
    return g ? structuredClone(g) : null;
  }
  async claimGeneration() {
    const g = [...this.gens.values()].filter((x) => x.state === "queued").sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!g) return null;
    g.state = "running";
    g.startedAt = Date.now();
    return structuredClone(g);
  }
  async updateGeneration(id: string, patch: Partial<Generation>) {
    Object.assign(this.gens.get(id)!, structuredClone(patch));
  }
  async requeueRunning() {
    let n = 0;
    for (const g of this.gens.values()) if (g.state === "running") (g.state = "queued"), n++;
    return n;
  }
  async appendEvent(id: string, line: LogLine) {
    const l = this.logs.get(id) ?? [];
    l.push(line);
    this.logs.set(id, l);
  }
  async events(id: string, after: number) {
    return (this.logs.get(id) ?? []).filter((l) => l.seq > after);
  }
  readonly runsById = new Map<string, Run>();
  readonly runLogs = new Map<string, RunEvent[]>();
  async latestGeneration(projectId: string) {
    const g = [...this.gens.values()].filter((x) => x.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt)[0];
    return g ? structuredClone(g) : null;
  }
  async createRun(r: Run) {
    this.runsById.set(r.id, structuredClone(r));
    return r;
  }
  async run(id: string) {
    const r = this.runsById.get(id);
    return r ? structuredClone(r) : null;
  }
  async runs(f: { projectId?: string; active?: boolean; limit?: number }) {
    return [...this.runsById.values()]
      .filter((r) => (!f.projectId || r.projectId === f.projectId) && (!f.active || ACTIVE_RUN_STATES.includes(r.state)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, f.limit ?? 20)
      .map((r) => structuredClone(r));
  }
  async updateRun(id: string, patch: Partial<Run>) {
    Object.assign(this.runsById.get(id)!, structuredClone(patch));
  }
  async appendRunEvents(id: string, events: RunEvent[]) {
    const l = this.runLogs.get(id) ?? [];
    l.push(...structuredClone(events));
    this.runLogs.set(id, l);
  }
  async runEvents(id: string, after: number, limit = 5000) {
    return (this.runLogs.get(id) ?? []).filter((e) => e.seq > after).slice(0, limit);
  }
}

export class DuplicateSlug extends Error {}

// ---- Postgres ---------------------------------------------------------------------------------------

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const MAX_EVENTS = 20_000;

type Row = Record<string, unknown>;
const ms = (v: unknown) => (v instanceof Date ? v.getTime() : v === null || v === undefined ? undefined : Number(v));
const parse = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export class PgRepo implements Repo {
  constructor(private readonly sql: SQL) {}

  static connect(url: string): PgRepo {
    return new PgRepo(new SQL(url));
  }

  async migrate() {
    await this.sql.begin(async (tx) => {
      // one migrator at a time across orchestrator replicas
      await tx`SELECT pg_advisory_xact_lock(hashtext('sv.migrations'))`;
      await tx`CREATE SCHEMA IF NOT EXISTS sv`;
      await tx`CREATE TABLE IF NOT EXISTS sv.schema_migration (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
      const done = new Set(((await tx`SELECT version FROM sv.schema_migration`) as Row[]).map((r) => String(r.version)));
      for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
        const version = file.replace(/\.sql$/, "");
        if (done.has(version)) continue;
        await tx.unsafe(readFileSync(MIGRATIONS + file, "utf8"));
        await tx`INSERT INTO sv.schema_migration (version) VALUES (${version})`;
      }
    });
  }

  private toProject(r: Row, workflows: Project["workflows"]): Project {
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      appName: String(r.app_name),
      language: r.language as Project["language"],
      vssRelease: String(r.vss_release),
      settings: parse<ProjectSettings>(r.settings),
      status: r.status as Project["status"],
      ...(r.status_message ? { statusMessage: String(r.status_message) } : {}),
      depsInstalled: Boolean(r.deps_installed),
      workflows,
    };
  }

  private async workflowsOf(id: string): Promise<Project["workflows"]> {
    const rows = (await this.sql`SELECT sim_workflow_id, enabled FROM sv.project_workflow WHERE project_id = ${id} ORDER BY sim_workflow_id`) as Row[];
    return rows.map((r) => ({ simWorkflowId: String(r.sim_workflow_id), enabled: Boolean(r.enabled) }));
  }

  async createProject(p: Omit<Project, "workflows" | "depsInstalled">) {
    try {
      await this.sql`INSERT INTO sv.project (id, slug, name, app_name, language, vss_release, settings, status, status_message)
        VALUES (${p.id}, ${p.slug}, ${p.name}, ${p.appName}, ${p.language}, ${p.vssRelease}, ${p.settings}, ${p.status}, ${p.statusMessage ?? null})`;
    } catch (e) {
      if (String((e as { code?: string }).code ?? (e as Error).message).includes("23505") || /duplicate key/.test((e as Error).message)) throw new DuplicateSlug(p.slug);
      throw e;
    }
    return (await this.project(p.id))!;
  }

  async project(k: string) {
    const isUuid = /^[0-9a-f-]{36}$/.test(k);
    const rows = (isUuid ? await this.sql`SELECT * FROM sv.project WHERE id = ${k}` : await this.sql`SELECT * FROM sv.project WHERE slug = ${k}`) as Row[];
    return rows[0] ? this.toProject(rows[0], await this.workflowsOf(String(rows[0].id))) : null;
  }

  async projects() {
    const rows = (await this.sql`SELECT * FROM sv.project ORDER BY created_at, slug`) as Row[];
    return Promise.all(rows.map(async (r) => this.toProject(r, await this.workflowsOf(String(r.id)))));
  }

  async updateProject(id: string, patch: Partial<Pick<Project, "status" | "statusMessage" | "depsInstalled">>) {
    if (patch.status !== undefined) await this.sql`UPDATE sv.project SET status = ${patch.status}, updated_at = now() WHERE id = ${id}`;
    if ("statusMessage" in patch) await this.sql`UPDATE sv.project SET status_message = ${patch.statusMessage ?? null}, updated_at = now() WHERE id = ${id}`;
    if (patch.depsInstalled !== undefined) await this.sql`UPDATE sv.project SET deps_installed = ${patch.depsInstalled}, updated_at = now() WHERE id = ${id}`;
  }

  async setWorkflows(id: string, workflows: Project["workflows"]) {
    await this.sql.begin(async (tx) => {
      await tx`DELETE FROM sv.project_workflow WHERE project_id = ${id}`;
      for (const w of workflows) await tx`INSERT INTO sv.project_workflow (project_id, sim_workflow_id, enabled) VALUES (${id}, ${w.simWorkflowId}, ${w.enabled})`;
    });
  }

  private toGeneration(r: Row): Generation {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      state: r.state as GenState,
      ...(r.stage ? { stage: r.stage as Stage } : {}),
      stages: parse(r.stages),
      verification: parse(r.verification),
      diagnostics: parse(r.diagnostics),
      generatedFiles: parse(r.generated_files),
      workflows: parse(r.workflows),
      ...(r.backend ? { backend: String(r.backend) } : {}),
      ...(r.compiler_version ? { compilerVersion: String(r.compiler_version) } : {}),
      ...(r.model_hash ? { modelHash: String(r.model_hash) } : {}),
      ...(r.run_info ? { runInfo: parse<RunInfo>(r.run_info) } : {}),
      request: parse(r.request),
      createdAt: ms(r.created_at)!,
      ...(r.started_at ? { startedAt: ms(r.started_at) } : {}),
      ...(r.finished_at ? { finishedAt: ms(r.finished_at) } : {}),
    };
  }

  async createGeneration(g: Generation) {
    await this.sql`INSERT INTO sv.generation (id, project_id, state, stages, verification, request, created_at)
      VALUES (${g.id}, ${g.projectId}, ${g.state}, ${g.stages}, ${g.verification}, ${g.request}, ${new Date(g.createdAt)})`;
    return g;
  }

  async generation(id: string) {
    const rows = (await this.sql`SELECT * FROM sv.generation WHERE id = ${id}`) as Row[];
    return rows[0] ? this.toGeneration(rows[0]) : null;
  }

  async claimGeneration() {
    const rows = (await this.sql`UPDATE sv.generation SET state = 'running', started_at = now()
      WHERE id = (SELECT id FROM sv.generation WHERE state = 'queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`) as Row[];
    return rows[0] ? this.toGeneration(rows[0]) : null;
  }

  async updateGeneration(id: string, patch: Partial<Generation>) {
    const set: Record<string, unknown> = {};
    if (patch.state !== undefined) set.state = patch.state;
    if ("stage" in patch) set.stage = patch.stage ?? null;
    if (patch.stages !== undefined) set.stages = patch.stages;
    if (patch.verification !== undefined) set.verification = patch.verification;
    if (patch.diagnostics !== undefined) set.diagnostics = patch.diagnostics;
    if (patch.generatedFiles !== undefined) set.generated_files = patch.generatedFiles;
    if (patch.workflows !== undefined) set.workflows = patch.workflows;
    if (patch.backend !== undefined) set.backend = patch.backend;
    if (patch.compilerVersion !== undefined) set.compiler_version = patch.compilerVersion;
    if (patch.modelHash !== undefined) set.model_hash = patch.modelHash;
    if (patch.runInfo !== undefined) set.run_info = patch.runInfo;
    if (patch.finishedAt !== undefined) set.finished_at = new Date(patch.finishedAt);
    if (Object.keys(set).length) await this.sql`UPDATE sv.generation SET ${this.sql(set)} WHERE id = ${id}`;
  }

  async requeueRunning() {
    const rows = (await this.sql`UPDATE sv.generation SET state = 'queued', started_at = NULL WHERE state = 'running' RETURNING id`) as Row[];
    return rows.length;
  }

  async appendEvent(id: string, line: LogLine) {
    await this.sql`INSERT INTO sv.generation_event (generation_id, seq, line) VALUES (${id}, ${line.seq}, ${line}) ON CONFLICT DO NOTHING`;
    if (line.seq > MAX_EVENTS && line.seq % 1000 === 0) await this.sql`DELETE FROM sv.generation_event WHERE generation_id = ${id} AND seq <= ${line.seq - MAX_EVENTS}`;
  }

  async events(id: string, after: number) {
    const rows = (await this.sql`SELECT line FROM sv.generation_event WHERE generation_id = ${id} AND seq > ${after} ORDER BY seq`) as Row[];
    return rows.map((r) => parse<LogLine>(r.line));
  }

  async latestGeneration(projectId: string) {
    const rows = (await this.sql`SELECT * FROM sv.generation WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`) as Row[];
    return rows[0] ? this.toGeneration(rows[0]) : null;
  }

  private toRun(r: Row): Run {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      generationId: String(r.generation_id),
      state: r.state as RunState,
      vssRelease: String(r.vss_release),
      traceLevel: r.trace_level as Run["traceLevel"],
      ...(r.job_id ? { jobId: String(r.job_id) } : {}),
      ...(r.exit_code !== null && r.exit_code !== undefined ? { exitCode: Number(r.exit_code) } : {}),
      diagnostics: parse(r.diagnostics),
      createdAt: ms(r.created_at)!,
      ...(r.running_at ? { runningAt: ms(r.running_at) } : {}),
      ...(r.finished_at ? { finishedAt: ms(r.finished_at) } : {}),
    };
  }

  async createRun(r: Run) {
    await this.sql`INSERT INTO sv.run (id, project_id, generation_id, state, vss_release, trace_level, diagnostics, created_at)
      VALUES (${r.id}, ${r.projectId}, ${r.generationId}, ${r.state}, ${r.vssRelease}, ${r.traceLevel}, ${r.diagnostics}, ${new Date(r.createdAt)})`;
    return r;
  }

  async run(id: string) {
    const rows = (await this.sql`SELECT * FROM sv.run WHERE id = ${id}`) as Row[];
    return rows[0] ? this.toRun(rows[0]) : null;
  }

  async runs(f: { projectId?: string; active?: boolean; limit?: number }) {
    const limit = f.limit ?? 20;
    const active = f.active === true;
    const rows = (f.projectId
      ? await this.sql`SELECT * FROM sv.run WHERE project_id = ${f.projectId} AND (${!active} OR state IN ('starting', 'running', 'stopping')) ORDER BY created_at DESC LIMIT ${limit}`
      : await this.sql`SELECT * FROM sv.run WHERE (${!active} OR state IN ('starting', 'running', 'stopping')) ORDER BY created_at DESC LIMIT ${limit}`) as Row[];
    return rows.map((r) => this.toRun(r));
  }

  async updateRun(id: string, patch: Partial<Run>) {
    const set: Record<string, unknown> = {};
    if (patch.state !== undefined) set.state = patch.state;
    if (patch.jobId !== undefined) set.job_id = patch.jobId;
    if (patch.exitCode !== undefined) set.exit_code = patch.exitCode;
    if (patch.diagnostics !== undefined) set.diagnostics = patch.diagnostics;
    if (patch.runningAt !== undefined) set.running_at = new Date(patch.runningAt);
    if (patch.finishedAt !== undefined) set.finished_at = new Date(patch.finishedAt);
    if (Object.keys(set).length) await this.sql`UPDATE sv.run SET ${this.sql(set)} WHERE id = ${id}`;
  }

  async appendRunEvents(id: string, events: RunEvent[]) {
    if (!events.length) return;
    const rows = events.map((e) => ({ run_id: id, seq: e.seq, kind: e.kind, body: e.body }));
    await this.sql`INSERT INTO sv.run_event ${this.sql(rows)} ON CONFLICT DO NOTHING`;
    // Ring buffer: a run keeps its newest MAX_EVENTS events (ADR-0027 §2).
    const last = events[events.length - 1]!.seq;
    if (last > MAX_EVENTS && Math.floor(last / 1000) !== Math.floor((events[0]!.seq - 1) / 1000)) await this.sql`DELETE FROM sv.run_event WHERE run_id = ${id} AND seq <= ${last - MAX_EVENTS}`;
  }

  async runEvents(id: string, after: number, limit = 5000) {
    const rows = (await this.sql`SELECT seq, kind, body FROM sv.run_event WHERE run_id = ${id} AND seq > ${after} ORDER BY seq LIMIT ${limit}`) as Row[];
    return rows.map((r) => ({ kind: r.kind, seq: Number(r.seq), body: parse(r.body) }) as RunEvent);
  }
}
