import { ContractValidator } from "@simvehicleapp/contracts";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { ConflictError, diag, type JobKind, type JobManager, type JobOptions } from "./jobs.ts";
import { PlanError } from "./commands.ts";

/**
 * HTTP surface of the toolchain agent (`openapi/toolchain.v1.yaml`): /jobs, /jobs/:id,
 * /jobs/:id/stream (SSE of LogLine v1, resumable), /jobs/:id/cancel, /templates. Auth, /healthz and
 * /version come from service-kit.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const validator = new ContractValidator();

export interface AgentDeps {
  jobs: JobManager;
  /** Template tar of a language, or null when this toolchain has none. */
  template(lang: string): ReadableStream<Uint8Array> | null;
}

export function createAgentHandler(deps: AgentDeps) {
  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/jobs") {
      if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(400, { error: "invalid_json" });
      }
      const v = validator.validate("toolchain-job#/$defs/request", body);
      if (!v.valid) return json(400, { error: "invalid_request", message: v.errors.slice(0, 3).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`).join("; ") });
      const { kind, project, options } = body as { kind: JobKind; project: string; options?: JobOptions };
      try {
        const job = deps.jobs.create(kind, project, options);
        ctx.log.info("job created", { job: job.id, kind, project });
        return json(202, job);
      } catch (e) {
        if (e instanceof ConflictError) return json(409, { error: "conflict", message: e.message });
        if (e instanceof PlanError) return json(422, [diag("BUILD_FAILED", "build", e.message, { kind })]);
        throw e;
      }
    }
    if (parts[0] === "jobs" && parts[1]) {
      const id = parts[1];
      const job = deps.jobs.get(id);
      if (!job) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") return json(200, job);
      if (parts[2] === "cancel" && req.method === "POST") return json(200, deps.jobs.cancel(id));
      if (parts[2] === "stream" && req.method === "GET") return stream(deps.jobs, id, req);
      return json(405, { error: "method_not_allowed" });
    }
    if (url.pathname === "/templates") {
      if (req.method !== "GET") return json(405, { error: "method_not_allowed" });
      const lang = url.searchParams.get("lang") ?? "";
      if (!["cpp", "python", "rust"].includes(lang)) return json(400, { error: "invalid_request", message: "lang must be cpp, python or rust" });
      const tar = deps.template(lang);
      if (!tar) return json(404, { error: "not_found", message: `this toolchain has no ${lang} template` });
      return new Response(tar, { headers: { "content-type": "application/x-tar" } });
    }
    return json(404, { error: "not_found" });
  };
}

/** SSE: `id` = seq, `data` = LogLine v1; resumes after Last-Event-ID; closes when the job ends. */
function stream(jobs: JobManager, id: string, req: Request): Response {
  const after = Number(req.headers.get("last-event-id") ?? -1);
  const enc = new TextEncoder();
  let unsubscribe = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      unsubscribe = jobs.subscribe(
        id,
        Number.isFinite(after) ? after : -1,
        (l) => {
          if (!closed) controller.enqueue(enc.encode(`id: ${l.seq}\nevent: log\ndata: ${JSON.stringify(l)}\n\n`));
        },
        close,
      );
      req.signal.addEventListener("abort", () => {
        unsubscribe();
        close();
      });
    },
    cancel() {
      unsubscribe();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
