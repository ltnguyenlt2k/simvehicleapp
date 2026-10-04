import { createHash } from "node:crypto";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { BLOCK_SPECS } from "@simvehicleapp/blocks";

/** Routes of `openapi/compiler.v1.yaml` not implemented yet, with the milestone that brings them. */
const PENDING: Readonly<Record<string, string>> = {
  "/compile": "M4",
  "/lint": "M4",
  "/opcodes": "M4",
  "/simulate": "M5",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Serialized once: the spec set is fixed for the lifetime of the process. */
const BLOCKS_BODY = JSON.stringify({ blocks: BLOCK_SPECS });
const BLOCKS_ETAG = `"${createHash("sha256").update(BLOCKS_BODY).digest("hex")}"`;

/** Auth, /healthz and /version are handled by service-kit. */
export function createCompilerHandler() {
  return async (req: Request, _ctx: RequestContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
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
