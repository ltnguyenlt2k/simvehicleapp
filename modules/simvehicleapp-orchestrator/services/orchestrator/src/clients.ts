import { AsyncLocalStorage } from "node:async_hooks";
import { internalHeaders } from "@simvehicleapp/service-kit";

/**
 * Request id the calls made inside `correlation.run(id, …)` carry (ADR-0033 §1): the SynCode worker
 * runs a generation under its id, so every service's log lines of that SynCode share it.
 */
export const correlation = new AsyncLocalStorage<string>();
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
  /** Read-only views of the project folder (workspace tree/file/generations), for the files viewer. */
  workspaceGet(path: string): Promise<Outcome<unknown>>;
  /** Runs a toolchain job to its end; every log line goes to `onLine`. */
  job(language: string, kind: string, project: string, onLine: (l: LogLine) => void, options?: Record<string, unknown>): Promise<ToolchainJob>;
  /** Starts a toolchain job (a `run` is followed separately); 409/422 come back as an outcome. */
  startJob(language: string, kind: string, project: string, options?: Record<string, unknown>): Promise<Outcome<ToolchainJob>>;
  /** Follows a job's log after `afterSeq` until it ends (reconnecting on drops); resolves with the final job. */
  followJob(language: string, jobId: string, afterSeq: number, onLine: (l: LogLine) => void): Promise<ToolchainJob>;
  /** Zip of the project folder plus `extraFiles` (workspace `exportProject`), as the raw response. */
  exportProject(slug: string, body: { generationId?: string; extraFiles: { path: string; content: string }[] }): Promise<Response>;
  /** Actuators whose target the signal-gateway mirrors to the current value (empty = none). */
  mirror(release: string, paths: string[]): Promise<void>;
  /** Health and version of every service the orchestrator drives (System status, ADR-0033 §4). */
  system(): Promise<ServiceStatus[]>;
}

export interface ServiceStatus {
  service: string;
  status: "ok" | "degraded" | "down";
  version?: string;
  commit?: string;
  contracts?: string;
  latencyMs?: number;
  error?: string;
}

export interface Endpoints {
  compiler: string;
  workspace: string;
  signalGateway?: string;
  backends: Record<string, string>;
  toolchains: Record<string, string>;
  secret: string;
}

export class ServiceUnavailable extends Error {}

export function httpClients(e: Endpoints): Clients {
  const headers = () => ({ ...internalHeaders(correlation.getStore() ?? crypto.randomUUID(), e.secret), "content-type": "application/json" });
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
    async workspaceGet(path) {
      return outcome(await call(`${e.workspace}${path}`));
    },
    async commit(slug, body) {
      return outcome(await call(`${e.workspace}/projects/${slug}/commits`, { method: "POST", body: JSON.stringify(body) }));
    },
    async job(language, kind, project, onLine, options) {
      const created = await this.startJob(language, kind, project, options);
      if (!created.ok) {
        if (created.status === 422) return { id: "", state: "failed", exitCode: null, diagnostics: created.diagnostics };
        throw new ServiceUnavailable(`toolchain /jobs ⇒ ${created.status}`);
      }
      return this.followJob(language, created.value.id, -1, onLine);
    },
    async startJob(language, kind, project, options) {
      const tc = base(e.toolchains, language, "toolchain");
      return outcome<ToolchainJob>(await call(`${tc}/jobs`, { method: "POST", body: JSON.stringify({ kind, project, ...(options ? { options } : {}) }) }));
    },
    async exportProject(slug, body) {
      return call(`${e.workspace}/projects/${slug}/export`, { method: "POST", body: JSON.stringify(body) });
    },
    async system() {
      const targets: [string, string][] = [
        ["compiler", e.compiler],
        ["workspace", e.workspace],
        ...(e.signalGateway ? ([["signal-gateway", e.signalGateway]] as [string, string][]) : []),
        ...Object.entries(e.backends).map(([l, u]) => [`codegen-${l}`, u] as [string, string]),
        ...Object.entries(e.toolchains).map(([l, u]) => [`toolchain-${l}`, u] as [string, string]),
      ];
      return Promise.all(
        targets.map(async ([service, url]): Promise<ServiceStatus> => {
          const t0 = performance.now();
          try {
            const health = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2000) });
            const latencyMs = Math.round(performance.now() - t0);
            const info = (await fetch(`${url}/version`, { signal: AbortSignal.timeout(2000) }).then((r) => r.json()).catch(() => ({}))) as { version?: string; commit?: string; contracts?: string };
            return { service, status: health.ok ? "ok" : "degraded", latencyMs, ...(info.version ? { version: info.version } : {}), ...(info.commit ? { commit: info.commit } : {}), ...(info.contracts ? { contracts: info.contracts } : {}) };
          } catch (err) {
            return { service, status: "down", error: (err as Error).name === "TimeoutError" ? "timeout" : "unreachable" };
          }
        }),
      );
    },
    async mirror(release, paths) {
      if (!e.signalGateway) return;
      const res = await call(`${e.signalGateway}/mirror`, { method: "PUT", body: JSON.stringify({ release, paths }) });
      if (!res.ok) throw new ServiceUnavailable(`signal-gateway /mirror ⇒ ${res.status}`);
    },
    async followJob(language, jobId, afterSeq, onLine) {
      const tc = base(e.toolchains, language, "toolchain");
      // Follow the log until the job ends (the stream closes then); resume after the last seq when it
      // drops. A run streams for hours: only consecutive failed connections give up.
      let last = afterSeq;
      for (let failures = 0; failures < 50; ) {
        const res = await call(`${tc}/jobs/${jobId}/stream`, { headers: { accept: "text/event-stream", "last-event-id": String(last) } }).catch(() => null);
        if (res?.ok && res.body) {
          failures = 0;
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
        } else failures++;
        const now = await call(`${tc}/jobs/${jobId}`)
          .then((r) => (r.ok ? (r.json() as Promise<ToolchainJob>) : null))
          .catch(() => null);
        if (now && !["queued", "running"].includes(now.state)) return now;
        await Bun.sleep(500);
      }
      throw new ServiceUnavailable(`toolchain job ${jobId}: the log stream is unreachable`);
    },
  };
}
