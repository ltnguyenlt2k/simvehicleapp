import { ContractValidator } from "@simvehicleapp/contracts";
import type { RequestContext } from "@simvehicleapp/service-kit";
import type { Clients } from "./clients.ts";
import { type EventHub, itemOfLine, itemOfRunEvent } from "./events.ts";
import { editorUrl, present } from "./pipeline.ts";
import type { EntitlementService, Feature } from "./entitlements.ts";
import { exportExtras } from "./export.ts";
import { type CapacityProbe, diskLow, type Limits, limitsFromEnv, queueFull, quotaExceeded } from "./governance.ts";
import { AppBusy, AppNotFailed, cleanApp, deleteApp, repairApp, type SweepResult } from "./lifecycle.ts";
import { createProject, DuplicateSlug } from "./projects.ts";
import { ACTIVE_RUN_STATES, type DeployTarget, DuplicateTargetName, type Generation, initialVerification, type Project, type Repo, type Run, STAGES } from "./repo.ts";
import { openToken, sealToken } from "./secrets.ts";
import { RunConflict, RunQuota, type RunManager } from "./runs.ts";

/**
 * HTTP surface of the orchestrator (`openapi/orchestrator.v1.yaml`): projects (vehicle apps) and their lifecycle
 * (delete, repair, clean, ADR-0053), their workflows, SynCode generations (queued; the worker runs them), the event
 * stream, and the host capacity checks made before an app is created or a SynCode is queued.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const validator = new ContractValidator();
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const OWNER = /^[A-Za-z0-9_-]{1,128}$/;
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
  /** Host limits (ADR-0053); default from the environment. */
  limits?: Limits;
  /** Free disk of the projects volume; without it the disk thresholds are not checked. */
  probe?: CapacityProbe;
  /** Runs the sweeper now (`POST /sweep`); `null` while a sweep is already running. Without it: 503. */
  sweep?: () => Promise<SweepResult | null>;
  /** INTERNAL_API_SECRET: seals deploy target tokens at rest (ADR-0060). */
  secret?: string;
  /** Wakes the generation worker. */
  kick(): void;
  background(p: Promise<void>): void;
}

const projectView = (p: Project, ideUrl?: string, ide = true) => {
  const editor = editorUrl(ideUrl, p);
  return {
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
    ...(p.status === "ready" && editor && ide ? { editor: { url: editor } } : {}),
    ...(p.createdAt ? { createdAt: p.createdAt } : {}),
    ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}),
  };
};

/** Run v1 of the contract (the toolchain job id stays internal). */
/** A deploy target without its token (never returned), only whether it has one. */
const targetView = (t: DeployTarget) => {
  const { tokenEnc, ...view } = t;
  return { ...view, hasToken: Boolean(tokenEnc) };
};
const TARGET_ADDRESS = /^[A-Za-z0-9.-]{1,253}:[0-9]{2,5}$/;
const VSS_PATH = /^Vehicle(\.[A-Za-z0-9_]+)+$/;

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
  const limits = d.limits ?? limitsFromEnv();
  const lifecycle = { repo: d.repo, clients: d.clients, runs: d.runs, probe: d.probe };
  /** Free disk at or below `level` (high: no new app, flood: no SynCode) ⇒ the 507 to answer, else null. */
  const diskBlocks = async (blocked: "app" | "syncode"): Promise<Response | null> => {
    const c = await d.probe?.get();
    if (!c) return null;
    const blocking = blocked === "app" ? c.level === "high" || c.level === "flood" : c.level === "flood";
    return blocking ? json(507, [diskLow(c, blocked)]) : null;
  };
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
      if (typeof slug !== "string" || !SLUG.test(slug) || typeof name !== "string" || !name.trim() || name.length > 200 || !["cpp", "python", "rust"].includes(language as string) || typeof vssRelease !== "string" || !/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/.test(vssRelease)) {
        return json(400, { error: "invalid_request", message: "slug, name, language (cpp|python|rust) and vssRelease (vX.Y or vX.Y-<name>) are required" });
      }
      if (appName !== undefined && (typeof appName !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(appName))) return json(400, { error: "invalid_request", message: "appName must be PascalCase" });
      const s = (settings ?? {}) as Record<string, unknown>;
      if (s.traceLevel !== undefined && !["off", "trigger", "node"].includes(s.traceLevel as string)) return json(400, { error: "invalid_request", message: "settings.traceLevel must be off, trigger or node" });
      if (s.mqttTopicPrefix !== undefined && (typeof s.mqttTopicPrefix !== "string" || !/^[^#+]+$/.test(s.mqttTopicPrefix))) return json(400, { error: "invalid_request", message: "settings.mqttTopicPrefix must not contain # or +" });
      const appCount = (await d.repo.projects()).length;
      const deniedCreate = entitled("project.create", { language: language as string, projectCount: appCount }, ctx.log);
      if (deniedCreate) return deniedCreate;
      if (appCount >= limits.maxAppsTotal) {
        ctx.log.warn("app quota reached", { scope: "host", limit: limits.maxAppsTotal });
        return json(409, [quotaExceeded("host", limits.maxAppsTotal, `This host already has ${appCount} vehicle apps`)]);
      }
      const noDisk = await diskBlocks("app");
      if (noDisk) return noDisk;
      try {
        const p = await createProject(d.repo, d.clients, { slug, name: name.trim(), language: language as Project["language"], vssRelease, ...(appName ? { appName: appName as string } : {}), settings: s as Partial<Project["settings"]> }, d.background);
        ctx.log.info("project created", { slug });
        return json(201, view(p));
      } catch (e) {
        if (e instanceof DuplicateSlug) return json(409, { error: "conflict", message: `project ${slug} already exists` });
        throw e;
      }
    }

    // Deploy targets of a workspace (ADR-0060, M18-T09): databrokers outside the stack the apps are deployed to.
    if (parts[0] === "deploy-targets") {
      const workspaceId = url.searchParams.get("workspaceId");
      if (parts.length === 1 && req.method === "GET") {
        if (!workspaceId || !OWNER.test(workspaceId)) return json(400, { error: "invalid_request", message: "workspaceId is required" });
        return json(200, { targets: (await d.repo.deployTargets(workspaceId)).map(targetView) });
      }
      if (parts.length === 1 && req.method === "POST") {
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const { workspaceId: ws, name, address, tls, token, vssRelease } = b as Record<string, unknown>;
        if (typeof ws !== "string" || !OWNER.test(ws)) return json(400, { error: "invalid_request", message: "workspaceId is required" });
        if (typeof name !== "string" || !name.trim() || name.length > 80) return json(400, { error: "invalid_request", message: "name: 1–80 characters" });
        if (typeof address !== "string" || !TARGET_ADDRESS.test(address)) return json(400, { error: "invalid_request", message: "address must be host:port" });
        if (tls !== undefined && typeof tls !== "boolean") return json(400, { error: "invalid_request", message: "tls must be a boolean" });
        if (token !== undefined && (typeof token !== "string" || token.length > 4096)) return json(400, { error: "invalid_request", message: "token must be a string" });
        if (typeof vssRelease !== "string" || !/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/.test(vssRelease)) return json(400, { error: "invalid_request", message: "vssRelease (vX.Y or vX.Y-<name>) is required" });
        if (token && !d.secret) return json(503, { error: "unavailable", message: "INTERNAL_API_SECRET is not set: a token cannot be stored" });
        try {
          const t = await d.repo.createDeployTarget({
            id: `dt_${crypto.randomUUID()}`,
            workspaceId: ws,
            name: name.trim(),
            address,
            tls: tls === true,
            ...(token ? { tokenEnc: await sealToken(token as string, d.secret!) } : {}),
            vssRelease,
            createdAt: Date.now(),
          });
          ctx.log.info("deploy target created", { target: t.id, workspace: ws, address, tls: t.tls });
          return json(201, targetView(t));
        } catch (e) {
          if (e instanceof DuplicateTargetName) return json(409, { error: "conflict", message: e.message });
          throw e;
        }
      }
      if (parts[1] && (parts.length === 2 || (parts.length === 3 && parts[2] === "test"))) {
        const t = await d.repo.deployTarget(parts[1]);
        // A target of another workspace is not found.
        const ws = parts.length === 2 ? workspaceId : (((await req.clone().json().catch(() => ({}))) as { workspaceId?: unknown }).workspaceId as string | undefined);
        if (!t || !ws || t.workspaceId !== ws) return json(404, { error: "not_found" });
        if (parts.length === 2 && req.method === "DELETE") {
          const using = (await d.repo.runs({ active: true, limit: 1000 })).filter((r) => r.deploy?.targetId === t.id);
          if (using.length) return json(409, { error: "conflict", message: `${t.name} has ${using.length} active deployment(s): stop them first`, runs: using.map(runView) });
          await d.repo.deleteDeployTarget(t.id);
          ctx.log.info("deploy target deleted", { target: t.id });
          return new Response(null, { status: 204 });
        }
        if (parts.length === 3 && req.method === "POST") {
          const b = await readBody(req);
          if (b instanceof Response) return b;
          const paths = (b.paths ?? []) as unknown;
          if (!Array.isArray(paths) || paths.length > 200 || !paths.every((p) => typeof p === "string" && VSS_PATH.test(p))) return json(400, { error: "invalid_request", message: "paths: at most 200 VSS paths" });
          const token = t.tokenEnc && d.secret ? await openToken(t.tokenEnc, d.secret) : undefined;
          const result = await d.clients.probeTarget({ target: t.address, tls: t.tls, ...(token ? { token } : {}), paths: paths as string[] });
          ctx.log.info("deploy target tested", { target: t.id, reachable: result.reachable });
          return json(200, result);
        }
      }
      return json(404, { error: "not_found" });
    }

    if (parts[0] === "projects" && parts[1]) {
      const project = ID.test(parts[1]) ? await d.repo.project(parts[1]) : null;
      if (!project) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") return json(200, view(project));
      if (parts.length === 2 && req.method === "DELETE") {
        try {
          await deleteApp({ ...lifecycle, log: ctx.log }, project);
          return new Response(null, { status: 204 });
        } catch (e) {
          if (e instanceof AppBusy) return json(409, { error: "conflict", message: e.message });
          ctx.log.error("delete failed", { app: project.slug, err: (e as Error).message });
          return json(502, { error: "unavailable", message: (e as Error).message });
        }
      }
      if (parts[2] === "repair" && parts.length === 3 && req.method === "POST") {
        const noDisk = await diskBlocks("app");
        if (noDisk) return noDisk;
        try {
          return json(202, view(await repairApp({ ...lifecycle, log: ctx.log }, project, d.background)));
        } catch (e) {
          if (e instanceof AppNotFailed || e instanceof AppBusy) return json(409, { error: "conflict", message: e.message });
          return json(502, { error: "unavailable", message: (e as Error).message });
        }
      }
      if (parts[2] === "size" && parts.length === 3 && req.method === "GET") {
        const r = await d.clients.workspaceSize(project.slug);
        return r.ok ? json(200, r.value) : json(r.status === 404 ? 404 : 502, { error: r.status === 404 ? "not_found" : "unavailable", message: "the workspace could not measure the app" });
      }
      if (parts[2] === "clean" && parts.length === 3 && req.method === "POST") {
        try {
          return json(200, await cleanApp({ ...lifecycle, log: ctx.log }, project));
        } catch (e) {
          if (e instanceof AppBusy) return json(409, { error: "conflict", message: e.message });
          return json(502, { error: "unavailable", message: (e as Error).message });
        }
      }
      if (parts[2] === "workflows" && parts.length === 3 && req.method === "PUT") {
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const list = b.workflows;
        if (!Array.isArray(list) || list.length > 500 || !list.every((w) => w && typeof w.simWorkflowId === "string" && ID.test(w.simWorkflowId) && (w.enabled === undefined || typeof w.enabled === "boolean"))) {
          return json(400, { error: "invalid_request", message: "workflows: [{simWorkflowId, enabled?}]" });
        }
        const enabledCount = list.filter((w: { enabled?: boolean }) => w.enabled !== false).length;
        if (enabledCount > limits.maxWorkflowsPerApp) return json(409, [quotaExceeded("app", limits.maxWorkflowsPerApp, `${enabledCount} workflows in one app`)]);
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
        const o = b.owner as { userId?: unknown; workspaceId?: unknown } | undefined;
        if (o !== undefined && (typeof o !== "object" || o === null || typeof o.userId !== "string" || !OWNER.test(o.userId) || (o.workspaceId !== undefined && (typeof o.workspaceId !== "string" || !OWNER.test(o.workspaceId))))) return json(400, { error: "invalid_request", message: "owner must be {userId, workspaceId?}" });
        // Default: the project's latest generation (RunManager checks it succeeded).
        const gid = (b.generationId as string | undefined) ?? (await d.repo.latestGeneration(project.id))?.id;
        if (!gid) return json(409, { error: "conflict", message: "SynCode the project first: it has no generation to run" });
        if (!(await d.repo.generation(gid))) return json(404, { error: "not_found", message: "unknown generation" });
        try {
          const run = await d.runs.start(project, gid, b.traceLevel as Run["traceLevel"] | undefined, o ? { userId: o.userId as string, ...(o.workspaceId ? { workspaceId: o.workspaceId as string } : {}) } : undefined);
          ctx.log.info("run requested", { project: project.slug, run: run.id, state: run.state });
          return json(202, runView(run));
        } catch (e) {
          if (e instanceof RunConflict) return json(409, { error: "conflict", message: e.message, ...(e.activeRun ? { activeRun: runView(e.activeRun) } : {}) });
          if (e instanceof RunQuota) return json(409, [{ ...e.diagnostic, data: { ...e.diagnostic.data, runs: e.own.map(runView) } }]);
          throw e;
        }
      }
      // Deploy as a container image (ADR-0060, M18-T10): the app's OCI image pushed to a registry by its toolchain.
      if (parts[2] === "images" && parts.length === 3 && req.method === "POST") {
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const { reference, insecure, username, password } = b as Record<string, unknown>;
        if (typeof reference !== "string" || !/^[A-Za-z0-9.-]+(:[0-9]{2,5})?\/[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/.test(reference))
          return json(400, { error: "invalid_request", message: "reference must be registry/repository[:tag]" });
        if ((insecure !== undefined && typeof insecure !== "boolean") || (username !== undefined && typeof username !== "string") || (password !== undefined && typeof password !== "string"))
          return json(400, { error: "invalid_request", message: "insecure must be a boolean, username and password strings" });
        if (project.status !== "ready") return json(409, { error: "not_ready", message: `${project.name} is not ready` });
        const latest = await d.repo.latestGeneration(project.id);
        if (latest?.state !== "succeeded") return json(409, { error: "conflict", message: "SynCode the app first: its latest SynCode must have passed" });
        const lines: string[] = [];
        const job = await d.clients.job(project.language, "image", project.slug, (l) => void lines.push(l.msg), {
          image: { reference, ...(insecure ? { insecure: true } : {}), ...(username ? { username: username as string, password: (password as string | undefined) ?? "" } : {}) },
        });
        const pushed = lines.map((l) => /^SVIMAGE (\{.*\})$/.exec(l)?.[1]).find(Boolean);
        if (job.state !== "succeeded" || !pushed) {
          ctx.log.warn("image failed", { project: project.slug, reference, state: job.state });
          return json(422, { error: "image_failed", message: job.diagnostics[0]?.message ?? lines.filter((l) => /fail|error|refused|not/i.test(l)).at(-1) ?? "the image was not pushed", log: lines.slice(-20) });
        }
        const result = JSON.parse(pushed) as { reference: string; digest: string; bytes: number; files: number };
        ctx.log.info("image pushed", { project: project.slug, reference, digest: result.digest, bytes: result.bytes });
        return json(200, { ...result, generationId: latest.id });
      }
      if (parts[2] === "deployments" && parts.length === 3 && req.method === "POST") {
        if (!d.runs) return json(503, { error: "unavailable", message: "runs are not enabled" });
        const b = await readBody(req);
        if (b instanceof Response) return b;
        const o = b.owner as { userId?: unknown; workspaceId?: unknown } | undefined;
        if (!o || typeof o.userId !== "string" || !OWNER.test(o.userId) || typeof o.workspaceId !== "string" || !OWNER.test(o.workspaceId)) return json(400, { error: "invalid_request", message: "owner {userId, workspaceId} is required" });
        if (b.mode !== "read-only" && b.mode !== "read-write") return json(400, { error: "invalid_request", message: "mode must be read-only or read-write" });
        if (typeof b.targetId !== "string") return json(400, { error: "invalid_request", message: "targetId is required" });
        const t = await d.repo.deployTarget(b.targetId);
        if (!t || t.workspaceId !== o.workspaceId) return json(404, { error: "not_found", message: "unknown deploy target" });
        if (t.vssRelease !== project.vssRelease) return json(409, { error: "conflict", message: `${t.name} serves VSS ${t.vssRelease}, ${project.name} is built for ${project.vssRelease}` });
        const gid = (typeof b.generationId === "string" ? b.generationId : undefined) ?? (await d.repo.latestGeneration(project.id))?.id;
        if (!gid) return json(409, { error: "conflict", message: "SynCode the project first: it has no generation to deploy" });
        try {
          const token = t.tokenEnc && d.secret ? await openToken(t.tokenEnc, d.secret) : undefined;
          const run = await d.runs.startDeployment(project, gid, { id: t.id, name: t.name, address: t.address, tls: t.tls, ...(token ? { token } : {}) }, b.mode, { userId: o.userId, workspaceId: o.workspaceId });
          ctx.log.info("deployment requested", { project: project.slug, run: run.id, target: t.id, mode: b.mode });
          return json(202, runView(run));
        } catch (e) {
          if (e instanceof RunConflict) return json(409, { error: "conflict", message: e.message, ...(e.activeRun ? { activeRun: runView(e.activeRun) } : {}) });
          if (e instanceof RunQuota) return json(409, [{ ...e.diagnostic, data: { ...e.diagnostic.data, runs: e.own.map(runView) } }]);
          throw e;
        }
      }
      if (parts[2] === "generations" && parts.length === 3 && req.method === "POST") {
        const deniedSynCode = entitled("syncode", { language: project.language }, ctx.log);
        if (deniedSynCode) return deniedSynCode;
        if (project.status !== "ready") return json(409, { error: "not_ready", message: project.status === "creating" ? `${project.name} is still being prepared: SynCode when it is ready` : `${project.name} failed to initialise: repair it first` });
        const noDisk = await diskBlocks("syncode");
        if (noDisk) return noDisk;
        const b = await readBody(req);
        if (b instanceof Response) return b;
        // `fromGeneration: "latest"`: SynCode again with the workflows (and scenarios) of the project's last
        // SynCode — for callers without the studio's graphs (MCP agents).
        if (b.fromGeneration === "latest" && b.graphs === undefined) {
          const last = await d.repo.latestGeneration(project.id);
          if (!last?.request?.graphs?.length) return json(409, { error: "no_previous_generation", message: `Project ${project.slug} has no SynCode yet: send graphs` });
          b.graphs = last.request.graphs;
          if (last.request.scenarios && b.scenarios === undefined) b.scenarios = last.request.scenarios;
        }
        const graphs = b.graphs;
        if (!Array.isArray(graphs) || graphs.length === 0 || graphs.length > 100) return json(400, { error: "invalid_request", message: "graphs: 1..100 workflow graphs" });
        const bad = graphs.map((g) => validator.validate("workflow-graph", g)).find((v) => !v.valid);
        if (bad) {
          return json(422, [{ code: "GRAPH_SCHEMA_INVALID", severity: "error", stage: "parse", message: `A workflow graph does not match WorkflowGraph v1: ${bad.errors.slice(0, 2).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`, docs: "diagnostics#GRAPH_SCHEMA_INVALID" }]);
        }
        const scenarios = b.scenarios;
        if (scenarios !== undefined && (!Array.isArray(scenarios) || !scenarios.every((s) => s && typeof s.workflowId === "string" && validator.validate("scenario", s.scenario).valid && (s.caseName === undefined || (typeof s.caseName === "string" && s.caseName.length >= 1 && s.caseName.length <= 80))))) {
          return json(400, { error: "invalid_request", message: "scenarios: [{workflowId, scenario (scenario v1), caseName?}]" });
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
        // ADR-0053: one queued SynCode per app (a newer request replaces it), a bounded queue, enough disk.
        for (const q of await d.repo.pendingGenerations(project.id)) {
          if (q.state === "queued" && (await d.repo.cancelQueued(q.id, Date.now()))) ctx.log.info("queued generation replaced", { project: project.slug, generation: q.id, by: g.id });
        }
        const queued = (await d.repo.pendingGenerations()).filter((q) => q.state === "queued").length;
        if (queued >= limits.maxQueued) {
          ctx.log.warn("SynCode queue full", { queued, limit: limits.maxQueued });
          return json(429, [queueFull(limits.maxQueued)]);
        }
        await d.repo.createGeneration(g);
        d.kick();
        ctx.log.info("generation queued", { project: project.slug, generation: g.id, workflows: graphs.length });
        return json(202, present(g, project, d.ideUrl));
      }
      if (parts[2] === "graphs" && parts.length === 3 && req.method === "GET") {
        // The WorkflowGraphs of the project's last SynCode (what its app was generated from).
        const last = await d.repo.latestGeneration(project.id);
        if (!last?.request?.graphs?.length) return json(404, { error: "not_found", message: `Project ${project.slug} has no SynCode yet` });
        return json(200, { generationId: last.id, graphs: last.request.graphs });
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

    if (url.pathname === "/capacity" && req.method === "GET") {
      const [disk, apps, pending, active] = await Promise.all([d.probe?.get() ?? Promise.resolve(null), d.repo.projects(), d.repo.pendingGenerations(), d.repo.runs({ active: true, limit: 1000 })]);
      return json(200, {
        disk,
        apps: { total: apps.length, limit: limits.maxAppsTotal },
        queue: { queued: pending.filter((q) => q.state === "queued").length, limit: limits.maxQueued },
        // Vehicle runtime (ADR-0057): apps running now against the host's run quota.
        ...(d.runs?.limits ? { runs: { active: active.length, limit: d.runs.limits.total, perUser: d.runs.limits.perUser, sandbox: d.runs.limits.sandbox, maxMinutes: d.runs.limits.maxMinutes } } : {}),
      });
    }
    if (url.pathname === "/sweep" && req.method === "POST") {
      if (!d.sweep) return json(503, { error: "unavailable", message: "the sweeper is not configured" });
      const r = await d.sweep();
      return r ? json(200, r) : json(409, { error: "conflict", message: "a sweep is already running" });
    }
    if (url.pathname === "/system" && req.method === "GET") {
      return json(200, { services: await d.clients.system() });
    }

    if (url.pathname === "/entitlements" && req.method === "GET") {
      return json(200, d.entitlements?.status ?? { mode: "full", licensed: false, reason: "no EntitlementService" });
    }

    if (url.pathname === "/runs" && req.method === "GET") {
      const projectId = url.searchParams.get("projectId");
      const ownerUserId = url.searchParams.get("ownerUserId");
      if ((projectId !== null && !ID.test(projectId)) || (ownerUserId !== null && !OWNER.test(ownerUserId))) return json(400, { error: "invalid_request" });
      const runs = await d.repo.runs({ ...(projectId ? { projectId } : {}), ...(ownerUserId ? { ownerUserId } : {}), active: url.searchParams.get("active") === "true", limit: 20 });
      // What the studio offers (run apps side by side, Extend) follows the limits (ADR-0057).
      return json(200, { runs: runs.map(runView), ...(d.runs?.limits ? { limits: d.runs.limits } : {}) });
    }

    if (parts[0] === "runs" && parts[1] && parts[2] === "audit" && parts.length === 3 && req.method === "GET") {
      const run = ID.test(parts[1]) ? await d.repo.run(parts[1]) : null;
      if (!run?.deploy) return json(404, { error: "not_found", message: "only a deployment has an audit" });
      return json(200, (await d.clients.routeAudit(run.id)) ?? { audit: [], forwarded: {} });
    }

    if (parts[0] === "runs" && parts[1] && (parts.length === 2 || (parts.length === 3 && (parts[2] === "stop" || parts[2] === "extend")))) {
      const run = ID.test(parts[1]) ? await d.repo.run(parts[1]) : null;
      if (!run) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") return json(200, runView(run));
      if (parts[2] === "stop" && req.method === "POST") {
        if (!d.runs) return json(503, { error: "unavailable", message: "runs are not enabled" });
        // `reason: admin` from `scripts/sv runs stop` (ADR-0057); the studio and the assistant stop as the user.
        const body = ((await req.json().catch(() => null)) ?? {}) as { reason?: unknown };
        const stopped = await d.runs.stop(run.id, body.reason === "admin" ? "admin" : "user");
        ctx.log.info("run stop requested", { run: run.id, ...(body.reason === "admin" ? { reason: "admin" } : {}) });
        return json(200, runView(stopped ?? run));
      }
      if (parts[2] === "extend" && req.method === "POST") {
        if (!d.runs) return json(503, { error: "unavailable", message: "runs are not enabled" });
        try {
          const extended = await d.runs.extend(run.id);
          ctx.log.info("run extended", { run: run.id, expiresAt: extended?.expiresAt });
          return json(200, runView(extended ?? run));
        } catch (e) {
          if (e instanceof RunConflict) return json(409, { error: "conflict", message: e.message });
          throw e;
        }
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
