import { createHash } from "node:crypto";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { VssParseError, VssSourceError, type NodeKind } from "@simvehicleapp/vss";
import { Catalog, lookup, search, tree, UnknownPathError, UnknownReleaseError } from "./catalog.ts";

const RELEASE = /^v[0-9]+\.[0-9]+$/;
/** contracts `common#/$defs/vssPath`. */
const VSS_PATH = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const KINDS = new Set<string>(["branch", "sensor", "actuator", "attribute"]);
const MAX_PATHS = 2000;

class BadRequest extends Error {}

const errorJson = (status: number, error: string, message?: string) =>
  new Response(JSON.stringify(message ? { error, message } : { error }), { status, headers: { "content-type": "application/json" } });

/**
 * JSON with a strong ETag = sha256 of the exact body bytes. Bodies are deterministic (release order,
 * fixed key order), so the same request on the same release always yields the same ETag.
 */
function cachedJson(req: Request, body: unknown): Response {
  const text = JSON.stringify(body);
  const etag = `"${createHash("sha256").update(text).digest("hex")}"`;
  const headers = { etag, "cache-control": "no-cache" };
  const match = req.headers.get("if-none-match");
  if (match && match.split(",").some((t) => t.trim().replace(/^W\//, "") === etag || t.trim() === "*")) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status: 200, headers: { ...headers, "content-type": "application/json" } });
}

function releaseParam(url: URL): string | undefined {
  const r = url.searchParams.get("release");
  if (r === null) return undefined;
  if (!RELEASE.test(r)) throw new BadRequest(`release must match ${RELEASE.source}`);
  return r;
}

function intParam(url: URL, name: string, min: number, max: number, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new BadRequest(`${name} must be an integer`);
  const n = Number(raw);
  if (n < min || n > max) throw new BadRequest(`${name} must be between ${min} and ${max}`);
  return n;
}

/** Routes of `openapi/vss-catalog.v1.yaml` (auth, /healthz and /version are handled by service-kit). */
export function createCatalogHandler(catalog: Catalog) {
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    if (req.method !== "GET") return errorJson(405, "method_not_allowed");
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case "/releases":
          return cachedJson(req, { releases: await catalog.releases() });

        case "/tree": {
          const release = releaseParam(url);
          const prefix = url.searchParams.get("prefix") ?? undefined;
          if (prefix !== undefined && !VSS_PATH.test(prefix)) throw new BadRequest("prefix must be a VSS path below the root");
          const depth = intParam(url, "depth", 1, 16, 1);
          const { model } = await catalog.get(release);
          return cachedJson(req, { release: model.release, nodes: tree(model, prefix, depth) });
        }

        case "/search": {
          const release = releaseParam(url);
          const q = url.searchParams.get("q") ?? "";
          if (q.length < 1 || q.length > 200) throw new BadRequest("q must be 1..200 characters");
          const kind = url.searchParams.get("type") ?? undefined;
          if (kind !== undefined && !KINDS.has(kind)) throw new BadRequest("type must be branch, sensor, actuator or attribute");
          const loaded = await catalog.get(release);
          return cachedJson(req, { release: loaded.model.release, nodes: search(loaded, q, kind as NodeKind | undefined) });
        }

        case "/nodes": {
          const release = releaseParam(url);
          const raw = url.searchParams.get("paths");
          if (!raw) throw new BadRequest("paths is required");
          const paths = raw.split(",");
          if (paths.length > MAX_PATHS) throw new BadRequest(`at most ${MAX_PATHS} paths`);
          const bad = paths.find((p) => !VSS_PATH.test(p));
          if (bad !== undefined) throw new BadRequest(`invalid VSS path '${bad.slice(0, 200)}'`);
          const { model } = await catalog.get(release);
          const { nodes, unknown } = lookup(model, paths);
          return cachedJson(req, unknown.length ? { release: model.release, nodes, unknown } : { release: model.release, nodes });
        }

        case "/vss": {
          // The release document, vendored into new projects as app/vss/<file> (ADR-0023 Notes M0).
          const loaded = await catalog.get(releaseParam(url));
          const etag = `"${loaded.model.modelHash.slice(7)}"`;
          if (req.headers.get("if-none-match")?.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers: { etag } });
          return new Response(loaded.documentJson, { headers: { etag, "cache-control": "no-cache", "content-type": "application/json", "x-sv-release": loaded.model.release } });
        }

        case "/model-hash": {
          const { model } = await catalog.get(releaseParam(url));
          return cachedJson(req, { release: model.release, modelHash: model.modelHash });
        }

        default:
          return errorJson(404, "not_found");
      }
    } catch (e) {
      if (e instanceof BadRequest) return errorJson(400, "invalid_request", e.message);
      if (e instanceof UnknownReleaseError) return errorJson(404, "unknown_release", e.message);
      if (e instanceof UnknownPathError) return errorJson(404, "unknown_path", e.message);
      if (e instanceof VssSourceError || e instanceof VssParseError) {
        // Upstream data problem, not a client error; details go to the log only.
        ctx.log.error("release unavailable", { err: e });
        return errorJson(503, "release_unavailable");
      }
      throw e;
    }
  };
}
