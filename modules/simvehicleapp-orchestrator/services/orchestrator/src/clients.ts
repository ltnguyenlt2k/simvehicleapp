import { internalHeaders } from "@simvehicleapp/service-kit";
import type { LogLine } from "./repo.ts";

/**
 * The services the orchestrator drives over HTTP (ADR-0007): compiler (`/compile`), a backend
 * (`/generate`), the workspace (create/commit) and a toolchain agent (jobs + SSE logs). Interfaces so
 * the pipeline runs against fakes in tests.
 */

export interface Diagnostic {
  code: string;
  severity: string;
  stage: string;
  message: string;
  docs: string;
  blockId?: string;
  nodeId?: string;
  workflowId?: string;
  data?: Record<string, unknown>;
}

export interface CompileResult {
  ir?: Record<string, unknown> & { workflowId: string; workflowRevision: number; irHash: string; compilerVersion: string; modelHash: string };
  diagnostics: Diagnostic[];
}

export interface FileSet {
  backend: string;
  runtimeVersion: string;
  files: { path: string; content: string; sha256: string; role: string }[];
  ownedRoots: string[];
  manifestFragment: Record<string, unknown>;
  sourceMaps: { file: string; ranges: { startLine: number; endLine: number; nodeId: string; blockId: string; workflowId: string }[] }[];
  diagnostics: Diagnostic[];
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; diagnostics: Diagnostic[]; message?: string };

export interface ToolchainJob {
  id: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
  diagnostics: Diagnostic[];
}

export interface Clients {
  compile(graph: unknown, target: string): Promise<CompileResult>;
  generate(language: string, request: unknown): Promise<Outcome<FileSet>>;
  createProject(body: { slug: string; language: string; appName: string; vssRelease: string }): Promise<Outcome<unknown>>;
  commit(slug: string, body: { generationId: string; fileset: FileSet; overwriteModified: boolean }): Promise<Outcome<unknown>>;
  /** Runs a toolchain job to its end; every log line goes to `onLine`. */
  job(language: string, kind: string, project: string, onLine: (l: LogLine) => void, options?: Record<string, unknown>): Promise<ToolchainJob>;
}

export interface Endpoints {
  compiler: string;
  workspace: string;
  backends: Record<string, string>;
  toolchains: Record<string, string>;
  secret: string;
}

export class ServiceUnavailable extends Error {}

export function httpClients(e: Endpoints): Clients {
  const headers = () => ({ ...internalHeaders(crypto.randomUUID(), e.secret), "content-type": "application/json" });
  const call = async (url: string, init: RequestInit = {}) => {
    try {
      return await fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) } });
    } catch (err) {
      throw new ServiceUnavailable(`${url}: ${(err as Error).message}`);
    }
  };
  const outcome = async <T>(res: Response): Promise<Outcome<T>> => {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    if (res.ok) return { ok: true, value: body as T };
    return { ok: false, status: res.status, diagnostics: Array.isArray(body) ? (body as Diagnostic[]) : [], ...(body && !Array.isArray(body) ? { message: String((body as { message?: string; error?: string }).message ?? (body as { error?: string }).error ?? "") } : {}) };
  };
  const base = (map: Record<string, string>, lang: string, what: string) => {
    const b = map[lang];
    if (!b) throw new ServiceUnavailable(`no ${what} for ${lang}`);
    return b;
  };
  return {
    async compile(graph, target) {
      const res = await call(`${e.compiler}/compile`, { method: "POST", body: JSON.stringify({ graph, mode: "build", target }) });
      if (!res.ok) throw new ServiceUnavailable(`compiler /compile ⇒ ${res.status}`);
      return (await res.json()) as CompileResult;
    },
    async generate(language, request) {
      return outcome<FileSet>(await call(`${base(e.backends, language, "backend")}/generate`, { method: "POST", body: JSON.stringify(request) }));
    },
    async createProject(body) {
      return outcome(await call(`${e.workspace}/projects`, { method: "POST", body: JSON.stringify(body) }));
    },
    async commit(slug, body) {
      return outcome(await call(`${e.workspace}/projects/${slug}/commits`, { method: "POST", body: JSON.stringify(body) }));
    },
    async job(language, kind, project, onLine, options) {
      const tc = base(e.toolchains, language, "toolchain");
      const created = await call(`${tc}/jobs`, { method: "POST", body: JSON.stringify({ kind, project, ...(options ? { options } : {}) }) });
      if (created.status === 422) {
        const d = (await created.json()) as Diagnostic[];
        return { id: "", state: "failed", exitCode: null, diagnostics: d };
      }
      if (!created.ok) throw new ServiceUnavailable(`toolchain /jobs ⇒ ${created.status}`);
      const job = (await created.json()) as ToolchainJob;
      // Follow the log until the job ends (the stream closes then); resume after the last seq if it drops.
      let last = -1;
      for (let attempt = 0; attempt < 50; attempt++) {
        const res = await call(`${tc}/jobs/${job.id}/stream`, { headers: { accept: "text/event-stream", "last-event-id": String(last) } });
        if (!res.ok || !res.body) break;
        const decoder = new TextDecoder();
        let buf = "";
        try {
          for await (const chunk of res.body) {
            buf += decoder.decode(chunk, { stream: true });
            let i = buf.indexOf("\n\n");
            while (i >= 0) {
              const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
              buf = buf.slice(i + 2);
              if (data) {
                const line = JSON.parse(data.slice(6)) as LogLine;
                last = line.seq;
                onLine(line);
              }
              i = buf.indexOf("\n\n");
            }
          }
        } catch {
          // dropped: reconnect below
        }
        const now = (await (await call(`${tc}/jobs/${job.id}`)).json()) as ToolchainJob;
        if (!["queued", "running"].includes(now.state)) return now;
        await Bun.sleep(500);
      }
      return (await (await call(`${tc}/jobs/${job.id}`)).json()) as ToolchainJob;
    },
  };
}
