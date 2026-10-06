import { createHash } from "node:crypto";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { BLOCK_SPECS } from "@simvehicleapp/blocks";
import { lint, type ModelHashLookup, type VehicleLookup } from "@simvehicleapp/compiler";
import { CatalogUnavailableError } from "./vehicle-lookup.ts";

/** Routes of `openapi/compiler.v1.yaml` not implemented yet, with the milestone that brings them. */
const PENDING: Readonly<Record<string, string>> = {
  "/compile": "M4",
  "/opcodes": "M4",
  "/simulate": "M5",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Serialized once: the spec set is fixed for the lifetime of the process. */
const BLOCKS_BODY = JSON.stringify({ blocks: BLOCK_SPECS });
const BLOCKS_ETAG = `"${createHash("sha256").update(BLOCKS_BODY).digest("hex")}"`;

/** Auth, /healthz and /version are handled by service-kit. */
export interface CompilerDeps {
  /** VSS lookup for lint/compile (vss-catalog over HTTP in the service). */
  vehicle: VehicleLookup;
  /** Catalog model hash per release (MODEL_HASH_MISMATCH for pinned graphs). */
  modelHash?: ModelHashLookup;
}

/** Request bodies above this are rejected before parsing (the compiler limit is 1 MB of graph). */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function createCompilerHandler(deps: CompilerDeps) {
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/lint") {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      const length = Number(req.headers.get("content-length") ?? 0);
      if (length > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const graph = (body as { graph?: unknown } | null)?.graph;
      if (graph === undefined) return json(400, { error: "invalid_request", message: "body.graph is required" });
      try {
        return json(200, { diagnostics: await lint(graph, { vehicle: deps.vehicle, modelHash: deps.modelHash }) });
      } catch (e) {
        if (e instanceof CatalogUnavailableError) {
          ctx.log.warn("lint without catalog", { err: e });
          return json(503, { error: "catalog_unavailable" });
        }
        throw e;
      }
    }
    if (pathname === "/blocks") {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      const headers = { etag: BLOCKS_ETAG, "cache-control": "no-cache" };
      const match = req.headers.get("if-none-match");
      if (match?.split(",").some((t) => t.trim().replace(/^W\//, "") === BLOCKS_ETAG || t.trim() === "*")) {
        return new Response(null, { status: 304, headers });
      }
      return new Response(BLOCKS_BODY, { status: 200, headers: { ...headers, "content-type": "application/json" } });
    }
    const milestone = PENDING[pathname];
    if (milestone) return json(501, { error: "not_implemented", message: `${pathname} arrives in ${milestone}` });
    return json(404, { error: "not_found" });
  };
}
