import { ContractValidator } from "@simvehicleapp/contracts";
import type { RequestContext } from "@simvehicleapp/service-kit";
import type { Clients } from "./clients.ts";
import { type EventHub, itemOfLine, itemOfRunEvent } from "./events.ts";
import { present } from "./pipeline.ts";
import type { EntitlementService, Feature } from "./entitlements.ts";
import { exportExtras } from "./export.ts";
import { createProject, DuplicateSlug } from "./projects.ts";
import { ACTIVE_RUN_STATES, type Generation, initialVerification, type Project, type Repo, type Run, STAGES } from "./repo.ts";
import { RunConflict, type RunManager } from "./runs.ts";

/**
 * HTTP surface of the orchestrator (`openapi/orchestrator.v1.yaml`): projects, their workflows,
 * SynCode generations (queued; the worker runs them) and the event stream.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const validator = new ContractValidator();
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const MAX_BODY = 16 * 1024 * 1024;

export interface AppDeps {
  repo: Repo;
  clients: Clients;
  hub: EventHub;
  /** Live runs (M8); without it the run endpoints answer 503. */
  runs?: RunManager;
  /** Licensed features (M09-T07, ADR-0031); without it everything is allowed. */
  entitlements?: EntitlementService;
  ideUrl?: string;
  /** Wakes the generation worker. */
  kick(): void;
  background(p: Promise<void>): void;
}

const projectView = (p: Project, ideUrl?: string, ide = true) => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  appName: p.appName,
  language: p.language,
  vssRelease: p.vssRelease,
  settings: p.settings,
  status: p.status,
  ...(p.statusMessage ? { statusMessage: p.statusMessage } : {}),
  workflows: p.workflows,
  ...(p.status === "ready" && ideUrl && ide ? { editor: { url: `${ideUrl.replace(/\/$/, "")}/?folder=/workspace/projects/${p.slug}` } } : {}),
});

/** Run v1 of the contract (the toolchain job id stays internal). */
const runView = (r: Run) => {
  const { jobId: _job, ...view } = r;
  return view;
};

async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json(413, { error: "payload_too_large" });
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : json(400, { error: "invalid_request" });
  } catch {
    return json(400, { error: "invalid_json" });
  }
}

/** Features whose decision other services ask for (the orchestrator gates its own actions itself). */
const ENTITLED_BY_OTHERS = new Set<string>(["ai.assistant"]);

export function createOrchestratorHandler(d: AppDeps) {
  const view = (p: Project) => projectView(p, d.ideUrl, d.entitlements?.allows("ide.access", { language: p.language }) ?? true);
  /** The PDP decision (logged); a denial is 403 with the reason (ADR-0031 §2). */
  const entitled = (feature: Feature, ctx: { language?: string; projectCount?: number }, log: RequestContext["log"]): Response | null => {
    if (!d.entitlements) return null;
    const decision = d.entitlements.check(feature, ctx);
    log.info("entitlement", { ...decision, ...ctx });
    return decision.allowed ? null : json(403, { error: "not_entitled", feature, message: decision.reason });
  };
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/projects") {
      if (req.method === "GET") return json(200, { projects: (await d.repo.projects()).map((p) => view(p)) });
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      const b = await readBody(req);
      if (b instanceof Response) return b;
      const { slug, name, language, vssRelease, appName, settings } = b as Record<string, unknown>;
      if (typeof slug !== "string" || !SLUG.test(slug) || typeof name !== "string" || !name.trim() || name.length > 200 || !["cpp", "python", "rust"].includes(language as string) || typeof vssRelease !== "string" || !/^v[0-9]+\.[0-9]+$/.test(vssRelease)) {
        return json(400, { error: "invalid_request", message: "slug, name, language (cpp|python|rust) and vssRelease (vX.Y) are required" });
      }
      if (appName !== undefined && (typeof appName !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(appName))) return json(400, { error: "invalid_request", message: "appName must be PascalCase" });
      const s = (settings ?? {}) as Record<string, unknown>;
      if (s.traceLevel !== undefined && !["off", "trigger", "node"].includes(s.traceLevel as string)) return json(400, { error: "invalid_request", message: "settings.traceLevel must be off, trigger or node" });
      if (s.mqttTopicPrefix !== undefined && (typeof s.mqttTopicPrefix !== "string" || !/^[^#+]+$/.test(s.mqttTopicPrefix))) return json(400, { error: "invalid_request", message: "settings.mqttTopicPrefix must not contain # or +" });
      const deniedCreate = entitled("project.create", { language: language as string, projectCount: (await d.repo.projects()).length }, ctx.log);
      if (deniedCreate) return deniedCreate;
      try {
        const p = await createProject(d.repo, d.clients, { slug, name: name.trim(), language: language as Project["language"], vssRelease, ...(appName ? { appName: appName as string } : {}), settings: s as Partial<Project["settings"]> }, d.background);
        ctx.log.info("project created", { slug });
        return json(201, view(p));
      } catch (e) {
        if (e instanceof DuplicateSlug) return json(409, { error: "conflict", message: `project ${slug} already exists` });
        throw e;
      }
    }

    if (parts[0] === "projects" && parts[1]) {
      const project = ID.test(parts[1]) ? await d.repo.project(parts[1]) : null;
      if (!project) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") return json(200, view(project));
      if (parts[2] === "workflows" && parts.length === 3 && req.method === "PUT") {
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const list = b.workflows;
        if (!Array.isArray(list) || list.length > 500 || !list.every((w) => w && typeof w.simWorkflowId === "string" && ID.test(w.simWorkflowId) && (w.enabled === undefined || typeof w.enabled === "boolean"))) {
          return json(400, { error: "invalid_request", message: "workflows: [{simWorkflowId, enabled?}]" });
        }
        await d.repo.setWorkflows(project.id, list.map((w: { simWorkflowId: string; enabled?: boolean }) => ({ simWorkflowId: w.simWorkflowId, enabled: w.enabled !== false })));
        return json(200, view((await d.repo.project(project.id))!));
      }
      if (parts[2] === "files" && parts.length === 3 && req.method === "GET") {
        // Tree + retained generations of the project folder (generated-files viewer, M07-T19).
        const [tree, gens] = await Promise.all([d.clients.workspaceGet(`/projects/${project.slug}/tree`), d.clients.workspaceGet(`/projects/${project.slug}/generations`)]);
        if (!tree.ok || !gens.ok) return json(tree.ok ? (gens as { status: number }).status : (tree as { status: number }).status, { error: "workspace_unavailable" });
        return json(200, { ...(tree.value as object), ...(gens.value as object) });
      }
      if (parts[2] === "file" && parts.length === 3 && req.method === "GET") {
        const path = url.searchParams.get("path") ?? "";
        const gid = url.searchParams.get("generationId");
        if (!path || path.length > 1024 || (gid !== null && !ID.test(gid))) return json(400, { error: "invalid_request" });
        const q = `?path=${encodeURIComponent(path)}`;
        const r = await d.clients.workspaceGet(gid ? `/projects/${project.slug}/generations/${gid}/file${q}` : `/projects/${project.slug}/file${q}`);
        return r.ok ? json(200, r.value) : json(r.status === 404 ? 404 : 502, { error: r.status === 404 ? "not_found" : "workspace_unavailable" });
      }
      if (parts[2] === "export" && parts.length === 3 && req.method === "POST") {
        // Export (M09-T06): the project folder as it is, plus what it was generated from.
        const denied = entitled("export.source", { language: project.language }, ctx.log);
        if (denied) return denied;
        const latest = await d.repo.latestGeneration(project.id);
        const exported = latest?.state === "succeeded" ? latest : null;
        const res = await d.clients.exportProject(project.slug, { ...(exported ? { generationId: exported.id } : {}), extraFiles: exportExtras(project, exported, d.entitlements?.document ?? null) });
        if (!res.ok || !res.body) return json(res.status === 409 ? 409 : 502, { error: res.status === 409 ? "conflict" : "workspace_unavailable", message: res.status === 409 ? "SynCode is changing the project: export when it has finished" : "the workspace could not export the project" });
        ctx.log.info("project exported", { project: project.slug, generation: exported?.id ?? null });
        return new Response(res.body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${project.slug}.zip"` } });
      }
      if (parts[2] === "runs" && parts.length === 3 && req.method === "POST") {
        if (!d.runs) return json(503, { error: "unavailable", message: "runs are not enabled" });
        const b = await readBody(req);
        if (b instanceof Response) return b;
        if (b.generationId !== undefined && (typeof b.generationId !== "string" || !ID.test(b.generationId))) return json(400, { error: "invalid_request", message: "generationId must be a generation id" });
        if (b.traceLevel !== undefined && !["off", "trigger", "node"].includes(b.traceLevel as string)) return json(400, { error: "invalid_request", message: "traceLevel must be off, trigger or node" });
        // Default: the project's latest generation (RunManager checks it succeeded).
        const gid = (b.generationId as string | undefined) ?? (await d.repo.latestGeneration(project.id))?.id;
        if (!gid) return json(409, { error: "conflict", message: "SynCode the project first: it has no generation to run" });
        if (!(await d.repo.generation(gid))) return json(404, { error: "not_found", message: "unknown generation" });
        try {
          const run = await d.runs.start(project, gid, b.traceLevel as Run["traceLevel"] | undefined);
          ctx.log.info("run requested", { project: project.slug, run: run.id, state: run.state });
          return json(202, runView(run));
        } catch (e) {
          if (e instanceof RunConflict) return json(409, { error: "conflict", message: e.message, ...(e.activeRun ? { activeRun: runView(e.activeRun) } : {}) });
          throw e;
        }
      }
      if (parts[2] === "generations" && parts.length === 3 && req.method === "POST") {
        const deniedSynCode = entitled("syncode", { language: project.language }, ctx.log);
        if (deniedSynCode) return deniedSynCode;
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const graphs = b.graphs;
        if (!Array.isArray(graphs) || graphs.length === 0 || graphs.length > 100) return json(400, { error: "invalid_request", message: "graphs: 1..100 workflow graphs" });
        const bad = graphs.map((g) => validator.validate("workflow-graph", g)).find((v) => !v.valid);
        if (bad) {
          return json(422, [{ code: "GRAPH_SCHEMA_INVALID", severity: "error", stage: "parse", message: `A workflow graph does not match WorkflowGraph v1: ${bad.errors.slice(0, 2).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`, docs: "diagnostics#GRAPH_SCHEMA_INVALID" }]);
        }
        const scenarios = b.scenarios;
        if (scenarios !== undefined && (!Array.isArray(scenarios) || !scenarios.every((s) => s && typeof s.workflowId === "string" && validator.validate("scenario", s.scenario).valid))) {
          return json(400, { error: "invalid_request", message: "scenarios: [{workflowId, scenario (scenario v1)}]" });
        }
        const g: Generation = {
          id: `g_${crypto.randomUUID()}`,
          projectId: project.id,
          state: "queued",
          stages: STAGES.map((name) => ({ name, state: "pending" })),
          verification: initialVerification(),
          diagnostics: [],
          generatedFiles: [],
          workflows: [],
          request: { graphs: graphs as Record<string, unknown>[], ...(scenarios ? { scenarios: scenarios as never } : {}), ...(b.overwriteModified === true ? { overwriteModified: true } : {}) },
          createdAt: Date.now(),
        };
        await d.repo.createGeneration(g);
        d.kick();
        ctx.log.info("generation queued", { project: project.slug, generation: g.id, workflows: graphs.length });
        return json(202, present(g, project, d.ideUrl));
      }
      if (parts[2] === "generations" && parts[3] && parts.length === 4 && req.method === "GET") {
        const g = ID.test(parts[3]) ? await d.repo.generation(parts[3]) : null;
        if (!g || g.projectId !== project.id) return json(404, { error: "not_found" });
        return json(200, present(g, project, d.ideUrl));
      }
      return json(404, { error: "not_found" });
    }

    // Decision for a feature used by another service (the ai-assistant asks for `ai.assistant` per turn).
    if (parts[0] === "entitlements" && parts.length === 2 && req.method === "GET") {
      const feature = decodeURIComponent(parts[1]!);
      if (!ENTITLED_BY_OTHERS.has(feature)) return json(404, { error: "not_found", message: `No decision for ${feature}` });
      if (!d.entitlements) return json(200, { feature, allowed: true, licensed: false, mode: "full", reason: "no EntitlementService" });
      const decision = d.entitlements.check(feature as Feature);
      ctx.log.info("entitlement", { ...decision });
      return json(200, decision);
    }

    if (url.pathname === "/entitlements" && req.method === "GET") {
      return json(200, d.entitlements?.status ?? { mode: "full", licensed: false, reason: "no EntitlementService" });
    }

    if (url.pathname === "/runs" && req.method === "GET") {
      const projectId = url.searchParams.get("projectId");
      if (projectId !== null && !ID.test(projectId)) return json(400, { error: "invalid_request" });
      const runs = await d.repo.runs({ ...(projectId ? { projectId } : {}), active: url.searchParams.get("active") === "true", limit: 20 });
      return json(200, { runs: runs.map(runView) });
    }

    if (parts[0] === "runs" && parts[1] && (parts.length === 2 || (parts.length === 3 && parts[2] === "stop"))) {
      const run = ID.test(parts[1]) ? await d.repo.run(parts[1]) : null;
      if (!run) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") return json(200, runView(run));
      if (parts[2] === "stop" && req.method === "POST") {
        if (!d.runs) return json(503, { error: "unavailable", message: "runs are not enabled" });
        const stopped = await d.runs.stop(run.id);
        ctx.log.info("run stop requested", { run: run.id });
        return json(200, runView(stopped ?? run));
      }
      return json(405, { error: "method_not_allowed" });
    }

    if (url.pathname === "/events" && req.method === "GET") {
      const after = Number(req.headers.get("last-event-id") ?? -1);
      const from = Number.isFinite(after) ? after : -1;
      const rid = url.searchParams.get("runId");
      if (rid !== null) {
        if (!ID.test(rid) || !(await d.repo.run(rid))) return json(404, { error: "not_found" });
        const finished = async () => {
          const r = await d.repo.run(rid);
          return !r || !ACTIVE_RUN_STATES.includes(r.state);
        };
        return d.hub.stream(rid, from, async (a) => (await d.repo.runEvents(rid, a)).map(itemOfRunEvent), finished, req.signal);
      }
      const gid = url.searchParams.get("generationId");
      if (!gid || !ID.test(gid)) return json(400, { error: "invalid_request", message: "runId or generationId is required" });
      if (!(await d.repo.generation(gid))) return json(404, { error: "not_found" });
      const finished = async () => {
        const g = await d.repo.generation(gid);
        return !g || ["succeeded", "failed", "cancelled"].includes(g.state);
      };
      return d.hub.stream(gid, from, async (a) => (await d.repo.events(gid, a)).map(itemOfLine), finished, req.signal);
    }
    return json(404, { error: "not_found" });
  };
}
