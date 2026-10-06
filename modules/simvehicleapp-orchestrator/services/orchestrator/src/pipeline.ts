import { type Clients, type Diagnostic, type FileSet, ServiceUnavailable } from "./clients.ts";
import { compileDiagnostics, depsDiagnostics, testDiagnostics } from "./errors.ts";
import type { Generation, LogLine, Project, Repo, Stage, StageInfo, Verdict } from "./repo.ts";
import { STAGES } from "./repo.ts";

/**
 * SynCode pipeline (ADR-0026, analysis/03 §4): ir → codegen → write → deps → build → format-check →
 * test, each stage recorded with its state and log lines; the generation ends with the Appendix A
 * verification `{ir, format, compile, tests}` or, on failure, the failing stage and diagnostics on
 * blocks (Appendix B). A failing stage skips the following ones.
 */

export interface EventSink {
  /** A log line of a generation (stored for resume, pushed to live subscribers). */
  line(generationId: string, line: LogLine): void;
  end(generationId: string): void;
}

export interface PipelineDeps {
  repo: Repo;
  clients: Clients;
  events: EventSink;
  /** IDE base URL (`editor.url` of Appendix A); the project folder is appended. */
  ideUrl?: string;
  now?: () => number;
}

const VERIFY_OF: Partial<Record<Stage, keyof Generation["verification"]>> = { ir: "ir", build: "compile", "format-check": "format", test: "tests" };

const diag = (code: string, stage: string, message: string, extra: Partial<Diagnostic> = {}): Diagnostic => ({ code, severity: "error", stage, message, docs: `diagnostics#${code}`, ...extra });

class StageFailed extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.message ?? "stage failed");
  }
}

export async function runGeneration(gen: Generation, deps: PipelineDeps): Promise<Generation> {
  const now = deps.now ?? Date.now;
  const { repo, clients } = deps;
  const project = (await repo.project(gen.projectId))!;
  let seq = (await repo.events(gen.id, -1)).length;
  const stages: StageInfo[] = STAGES.map((name) => ({ name, state: "pending" }));
  const verification: Generation["verification"] = { ir: "pending", format: "pending", compile: "pending", tests: "pending" };
  const state: Partial<Generation> = { stages, verification };

  const emit = (msg: string, level: LogLine["level"] = "info", stream: LogLine["stream"] = "system", raw?: string) => {
    const l: LogLine = { runId: gen.id, seq: seq++, ts: now(), stream, level, msg, ...(raw && raw !== msg ? { raw } : {}) };
    void repo.appendEvent(gen.id, l);
    deps.events.line(gen.id, l);
  };
  const save = () => repo.updateGeneration(gen.id, state);

  let files: FileSet | null = null;
  const irs: NonNullable<Awaited<ReturnType<Clients["compile"]>>["ir"]>[] = [];

  const stage = async (name: Stage, body: () => Promise<Verdict | void>) => {
    const s = stages.find((x) => x.name === name)!;
    s.state = "running";
    s.startedAt = now();
    state.stage = name;
    await save();
    emit(`▶ ${name}`);
    let verdict: Verdict | void;
    try {
      verdict = await body();
    } catch (e) {
      s.state = "failed";
      s.finishedAt = now();
      const k = VERIFY_OF[name];
      if (k) verification[k] = "failed";
      throw e;
    }
    s.state = verdict === "skipped" ? "skipped" : "passed";
    s.finishedAt = now();
    const k = VERIFY_OF[name];
    if (k) verification[k] = verdict === "skipped" ? "skipped" : "passed";
    emit(`✔ ${name}${verdict === "skipped" ? " (skipped)" : ""}`);
    await save();
  };

  /** A toolchain job; its lines are forwarded and kept for error mapping. */
  const job = async (kind: string, options?: Record<string, unknown>) => {
    const lines: string[] = [];
    const result = await clients.job(project.language, kind, project.slug, (l) => {
      if (l.stream === "system" && /^job (succeeded|failed|cancelled)$/.test(l.msg)) return;
      lines.push(l.msg);
      emit(l.msg, l.level, l.stream === "system" ? "system" : l.stream, l.raw);
    }, options);
    return { result, lines };
  };

  try {
    if (project.status !== "ready") throw new StageFailed([diag("WORKSPACE_COMMIT_FAILED", "workspace", `Project ${project.slug} is not ready (${project.status}${project.statusMessage ? `: ${project.statusMessage}` : ""})`)]);

    await stage("ir", async () => {
      const problems: Diagnostic[] = [];
      for (const graph of gen.request.graphs) {
        const workflowId = String(graph.workflowId ?? "");
        const release = (graph.vss as { release?: string } | undefined)?.release;
        if (release && release !== project.vssRelease) {
          problems.push(diag("PROJECT_VSS_RELEASE_MISMATCH", "codegen", `Workflow ${String(graph.name ?? workflowId)} uses VSS ${release}, the project uses ${project.vssRelease}`, { workflowId, data: { workflow: release, project: project.vssRelease } }));
          continue;
        }
        const r = await clients.compile(graph, project.language);
        const errors = r.diagnostics.filter((d) => d.severity === "error");
        if (!r.ir || errors.length) problems.push(...(errors.length ? errors : r.diagnostics).map((d) => ({ ...d, workflowId: d.workflowId ?? workflowId })));
        else irs.push(r.ir);
      }
      if (problems.length) throw new StageFailed(problems);
      state.workflows = irs.map((ir) => ({ workflowId: ir.workflowId, revision: ir.workflowRevision, irHash: ir.irHash }));
      state.compilerVersion = irs[0]?.compilerVersion;
      state.modelHash = irs[0]?.modelHash;
      emit(`${irs.length} workflow(s) compiled`);
    });

    await stage("codegen", async () => {
      const r = await clients.generate(project.language, {
        project: { slug: project.slug, appName: project.appName, language: project.language, mqttTopicPrefix: project.settings.mqttTopicPrefix, traceLevel: project.settings.traceLevel },
        workflows: irs,
        options: { emitTests: true },
        ...(gen.request.scenarios?.length ? { scenarios: gen.request.scenarios.filter((s) => irs.some((ir) => ir.workflowId === s.workflowId)) } : {}),
      });
      if (!r.ok) throw new StageFailed(r.diagnostics.length ? r.diagnostics : [diag("CODEGEN_INTERNAL_ERROR", "codegen", `The ${project.language} backend refused the request (${r.status}${r.message ? `: ${r.message}` : ""})`)]);
      files = r.value;
      state.backend = files.backend;
      state.generatedFiles = files.files.map((f) => f.path);
      emit(`${files.files.length} files generated by ${files.backend}`);
    });

    await stage("write", async () => {
      const r = await clients.commit(project.slug, { generationId: gen.id, fileset: files!, overwriteModified: gen.request.overwriteModified === true });
      if (!r.ok) throw new StageFailed(r.diagnostics.length ? r.diagnostics : [diag("WORKSPACE_COMMIT_FAILED", "workspace", `Writing the project failed (${r.status}${r.message ? `: ${r.message}` : ""})`)]);
    });

    await stage("deps", async () => {
      if (project.depsInstalled) return "skipped";
      const { result, lines } = await job("deps");
      if (result.state !== "succeeded") throw new StageFailed(depsDiagnostics(lines));
      await repo.updateProject(project.id, { depsInstalled: true });
    });

    await stage("build", async () => {
      const { result, lines } = await job("build");
      if (result.state !== "succeeded") {
        const mapped = compileDiagnostics(lines, files!.sourceMaps);
        throw new StageFailed(mapped.length ? mapped : result.diagnostics.length ? result.diagnostics : [diag("BUILD_FAILED", "build", "The build failed (see the build log)")]);
      }
    });

    await stage("format-check", async () => {
      const { result } = await job("format-check");
      if (result.state !== "succeeded") throw new StageFailed(result.diagnostics.length ? result.diagnostics : [diag("BUILD_FAILED", "build", "Generated files are not formatted")]);
    });

    await stage("test", async () => {
      const { result, lines } = await job("test");
      if (result.state !== "succeeded") {
        const classes = new Map<string, string>();
        for (const m of files!.sourceMaps) {
          const cls = /workflows\/(\w+)\.cpp$/.exec(m.file)?.[1];
          const wf = m.ranges[0]?.workflowId;
          if (cls && wf) classes.set(cls, wf);
        }
        const mapped = testDiagnostics(lines, (cls) => classes.get(cls));
        throw new StageFailed(mapped.length ? mapped : [diag("GENERATED_TEST_FAILED", "test", "The generated tests failed (see the log)")]);
      }
    });

    state.state = "succeeded";
    state.stage = undefined;
    state.diagnostics = [];
    emit("SynCode passed");
  } catch (e) {
    const failed = stages.find((s) => s.state === "failed" || s.state === "running");
    if (failed) failed.state = "failed";
    for (const s of stages) if (s.state === "pending") s.state = "skipped";
    for (const k of Object.keys(verification) as (keyof Generation["verification"])[]) if (verification[k] === "pending") verification[k] = "skipped";
    state.state = "failed";
    state.stage = failed?.name;
    if (e instanceof StageFailed) state.diagnostics = e.diagnostics;
    else {
      const infra = e instanceof ServiceUnavailable;
      state.diagnostics = [diag(infra ? "BACKEND_UNAVAILABLE" : "CODEGEN_INTERNAL_ERROR", infra ? "backend" : "codegen", `${infra ? "A service is unavailable" : "SynCode failed unexpectedly"}: ${(e as Error).message}`)];
    }
    for (const d of state.diagnostics as Diagnostic[]) emit(`✘ ${d.code}: ${d.message}`, "error");
  }
  state.finishedAt = now();
  await save();
  deps.events.end(gen.id);
  return (await repo.generation(gen.id))!;
}

/** Appendix A/B view of a generation (`GET …/generations/{gid}`). */
export function present(g: Generation, project: Project, ideUrl?: string) {
  const done = g.state === "succeeded" || g.state === "failed" || g.state === "cancelled";
  return {
    id: g.id,
    generationId: g.id,
    projectId: g.projectId,
    state: g.state,
    ...(done ? { success: g.state === "succeeded" } : {}),
    ...(g.stage ? { stage: g.stage } : {}),
    stages: g.stages,
    verification: g.verification,
    diagnostics: g.diagnostics,
    generatedFiles: g.generatedFiles,
    workflows: g.workflows,
    ...(g.workflows.length === 1 ? { workflowRevision: g.workflows[0]!.revision } : {}),
    ...(g.modelHash ? { modelHash: g.modelHash } : {}),
    ...(g.compilerVersion ? { compilerVersion: g.compilerVersion } : {}),
    ...(g.backend ? { backend: g.backend } : {}),
    ...(g.state === "succeeded" && ideUrl ? { editor: { url: `${ideUrl.replace(/\/$/, "")}/?folder=/workspace/projects/${project.slug}` } } : {}),
    createdAt: g.createdAt,
    ...(g.finishedAt ? { finishedAt: g.finishedAt } : {}),
  };
}
