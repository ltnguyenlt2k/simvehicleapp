import type { RequestContext } from "@simvehicleapp/service-kit";
import { InitFailed, initProject, type InitSources, ProjectExists, type ProjectRequest, syncProjectVss } from "./init.ts";
import { normalizeRelative, PathRejected, SLUG } from "./paths.ts";
import type { Capacity } from "./capacity.ts";
import { CommitRejected, Crash, type FileSet, type Store } from "./store.ts";
import { zip } from "./zip.ts";

/** Files the orchestrator adds to an export (ADR-0031 §1): `.simvehicleapp/**` and the top-level notices. */
const EXPORT_EXTRA = /^(\.simvehicleapp\/.+|README\.SIMVEHICLE\.md|NOTICE|THIRD-PARTY-NOTICES)$/;

/**
 * HTTP surface of the workspace (`openapi/workspace.v1.yaml`): project creation, generation commits,
 * rollback, tree, the read-only file/generation views of the generated-files viewer and exports.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const diag = (code: string, message: string, data?: Record<string, unknown>) => ({ code, severity: "error", stage: "workspace", message, docs: `diagnostics#${code}`, ...(data ? { data } : {}) });
const GID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const MAX_BODY = 32 * 1024 * 1024;

async function body(req: Request): Promise<Record<string, unknown> | Response> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json(413, { error: "payload_too_large" });
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : json(400, { error: "invalid_request" });
  } catch {
    return json(400, { error: "invalid_json" });
  }
}

export function createWorkspaceHandler(store: Store, sources: InitSources, capacity?: () => Capacity) {
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (url.pathname === "/projects" && req.method === "POST") {
        const b = await body(req);
        if (b instanceof Response) return b;
        const { slug, language, appName, vssRelease, target } = b as Record<string, string>;
        if (typeof slug !== "string" || !SLUG.test(slug) || !["cpp", "python", "rust"].includes(language!) || !/^[A-Z][A-Za-z0-9]*$/.test(appName ?? "") || !/^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/.test(vssRelease ?? "")) {
          return json(400, { error: "invalid_request", message: "slug, language (cpp|python|rust), appName (PascalCase) and vssRelease (vX.Y or vX.Y-<name>) are required" });
        }
        if (target !== undefined && target !== "velocitas" && target !== "wasm") return json(400, { error: "invalid_request", message: "target must be velocitas or wasm" });
        try {
          const p = await initProject(store, { slug, language: language as ProjectRequest["language"], ...(target === "wasm" ? { target: "wasm" as const } : {}), appName: appName!, vssRelease: vssRelease! }, sources);
          ctx.log.info("project created", { slug });
          return json(201, p);
        } catch (e) {
          if (e instanceof ProjectExists) return json(409, { error: "conflict", message: e.message });
          if (e instanceof InitFailed || e instanceof PathRejected) return json(422, [diag("WORKSPACE_COMMIT_FAILED", e.message)]);
          throw e;
        }
      }
      if (url.pathname === "/capacity" && req.method === "GET") {
        if (!capacity) return json(503, { error: "unavailable", message: "capacity is not measured here" });
        return json(200, capacity());
      }
      if (parts[0] !== "projects" || !parts[1]) return json(404, { error: "not_found" });
      const slug = parts[1];
      // Delete is idempotent (ADR-0053): a project already gone answers 204 too, so it is handled before the existence check.
      if (parts.length === 2 && req.method === "DELETE") {
        if (!SLUG.test(slug)) return json(422, [diag("WORKSPACE_PATH_REJECTED", `invalid project slug ${slug}`, { path: slug, reason: "invalid project slug" })]);
        await store.deleteProject(slug);
        ctx.log.info("project deleted", { slug });
        return new Response(null, { status: 204 });
      }
      if (!SLUG.test(slug) || !store.exists(slug)) return json(404, { error: "not_found", message: `no project ${slug}` });
      const op = parts.slice(2).join("/");

      if (op === "commits" && req.method === "POST") {
        const b = await body(req);
        if (b instanceof Response) return b;
        const gid = b.generationId;
        if (typeof gid !== "string" || !GID.test(gid) || !b.fileset || typeof b.fileset !== "object") return json(400, { error: "invalid_request", message: "generationId and fileset are required" });
        try {
          const record = await store.commit(slug, gid, b.fileset as FileSet, b.overwriteModified === true);
          ctx.log.info("generation committed", { slug, gid, files: record.files.length });
          return json(200, record);
        } catch (e) {
          if (e instanceof CommitRejected) return json(e.status, e.diagnostics);
          if (e instanceof Crash) {
            // Fault injection (SV_FAULT_AT, tests only): die like a killed process, mid-commit.
            ctx.log.error("fault injection: exiting mid-commit", { slug, gid, point: e.message });
            process.exit(137);
          }
          if (e instanceof PathRejected) return json(422, [diag("WORKSPACE_PATH_REJECTED", e.message, { path: e.path, reason: e.reason })]);
          throw e;
        }
      }
      if (op === "clean" && req.method === "POST") {
        const freedBytes = await store.cleanProject(slug);
        ctx.log.info("project cleaned", { slug, freedBytes });
        return json(200, { freedBytes });
      }
      if (op === "size" && req.method === "GET") return json(200, store.projectSize(slug));
      if (op === "vss-sync" && req.method === "POST") {
        // Before each SynCode build (orchestrator): the project's VSS file follows its release in the catalog.
        try {
          const r = await store.serialize(slug, () => syncProjectVss(store, slug, sources));
          if (r.changed) ctx.log.info("project VSS updated from the catalog", { slug, release: r.release, path: r.path });
          return json(200, r);
        } catch (e) {
          if (e instanceof PathRejected) return json(422, [diag("WORKSPACE_PATH_REJECTED", e.message, { path: e.path, reason: e.reason })]);
          return json(502, [diag("WORKSPACE_COMMIT_FAILED", `VSS sync failed: ${(e as Error).message}`)]);
        }
      }
      if (op === "rollback" && req.method === "POST") {
        const b = await body(req);
        if (b instanceof Response) return b;
        if (typeof b.generationId !== "string" || !GID.test(b.generationId)) return json(400, { error: "invalid_request" });
        const record = await store.rollback(slug, b.generationId);
        return record ? json(200, record) : json(404, { error: "not_found", message: "generation not retained (the last 10 are kept)" });
      }
      if (op === "tree" && req.method === "GET") return json(200, { files: store.tree(slug) });
      if (op === "file" && req.method === "GET") {
        const path = url.searchParams.get("path") ?? "";
        try {
          return json(200, { path, content: store.readFile(slug, path) });
        } catch (e) {
          if (e instanceof PathRejected) return json(404, { error: "not_found", message: e.message });
          throw e;
        }
      }
      if (op === "generations" && req.method === "GET") {
        const current = store.currentGeneration(slug);
        return json(200, { current: current?.generationId ?? null, generations: store.generationIds(slug) });
      }
      if (parts[2] === "generations" && parts[3] && parts[4] === "file" && req.method === "GET") {
        const fs = GID.test(parts[3]) ? store.storedFileSet(slug, parts[3]) : null;
        const f = fs?.files.find((x) => x.path === url.searchParams.get("path"));
        return f ? json(200, { path: f.path, content: f.content }) : json(404, { error: "not_found" });
      }
      if (op === "export" && req.method === "POST") {
        const b = await body(req);
        if (b instanceof Response) return b;
        // The folder holds one generation: exporting another one would mix sources (409).
        const current = store.currentGeneration(slug)?.generationId ?? null;
        if (b.generationId !== undefined && b.generationId !== current) return json(409, { error: "conflict", message: `the project holds generation ${current ?? "none"}, not ${String(b.generationId)}` });
        const extras = b.extraFiles ?? [];
        if (!Array.isArray(extras) || extras.length > 500) return json(400, { error: "invalid_request", message: "extraFiles: at most 500 {path, content}" });
        const added = new Map<string, Uint8Array>();
        for (const f of extras as { path?: unknown; content?: unknown }[]) {
          if (typeof f?.path !== "string" || typeof f.content !== "string") return json(400, { error: "invalid_request", message: "extraFiles: [{path, content}]" });
          const path = normalizeRelative(f.path);
          if (!EXPORT_EXTRA.test(path)) return json(400, { error: "invalid_request", message: `${path}: extra files go under .simvehicleapp/ or are README.SIMVEHICLE.md, NOTICE, THIRD-PARTY-NOTICES` });
          added.set(path, new TextEncoder().encode(f.content));
        }
        const files = store.exportFiles(slug).filter((f) => !added.has(f.path));
        const bytes = zip([...files, ...[...added].map(([path, data]) => ({ path, data }))]);
        ctx.log.info("project exported", { slug, files: files.length + added.size, bytes: bytes.length });
        return new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${slug}.zip"` } });
      }
      return json(404, { error: "not_found" });
    } catch (e) {
      if (e instanceof PathRejected) return json(422, [diag("WORKSPACE_PATH_REJECTED", e.message, { path: e.path, reason: e.reason })]);
      throw e;
    }
  };
}
