import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { type FileBundle, MODULE_DIR, overlayBundle, runtimeBundle } from "./bundle.ts";
import { generate } from "./generate.ts";

/**
 * HTTP surface of the Rust backend (`openapi/backend-plugin.v1.yaml`): /capabilities, /generate,
 * /runtime/files, /template-overlay/files. Auth, /healthz and /version come from service-kit.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Generation requests carry IR documents; 8 MB is far above the compiler's 1 MB graph limit. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** backend.yaml as JSON (GET /capabilities). */
export function capabilities(moduleDir = MODULE_DIR): Record<string, unknown> {
  return Bun.YAML.parse(readFileSync(join(moduleDir, "backend.yaml"), "utf8")) as Record<string, unknown>;
}

export function createBackendHandler(moduleDir = MODULE_DIR) {
  // Everything static is read once at start-up; requests never touch the disk.
  const caps = JSON.stringify(capabilities(moduleDir));
  const bundles: Record<string, FileBundle> = {
    "/runtime/files": runtimeBundle(moduleDir),
    "/template-overlay/files": overlayBundle(moduleDir),
  };
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const { pathname } = new URL(req.url);
    if (pathname === "/capabilities" || pathname in bundles) {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      return pathname === "/capabilities" ? new Response(caps, { headers: { "content-type": "application/json" } }) : json(200, bundles[pathname]);
    }
    if (pathname === "/generate") {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { error: "payload_too_large" });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const r = generate(body);
      if (r.ok) return json(200, r.fileSet);
      if (r.status === 400) return json(400, { error: "invalid_request", message: r.error });
      ctx.log.info("generate rejected", { codes: r.diagnostics.map((d) => d.code) });
      return json(422, r.diagnostics);
    }
    return json(404, { error: "not_found" });
  };
}
