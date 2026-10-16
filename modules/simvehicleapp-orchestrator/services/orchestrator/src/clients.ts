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
  /** Sandboxed run: where its databroker listens (ADR-0057). */
  sandbox?: { address: string };
}

export interface Clients {
  compile(graph: unknown, target: string): Promise<CompileResult>;
  generate(language: string, request: unknown): Promise<Outcome<FileSet>>;
  createProject(body: { slug: string; language: string; appName: string; vssRelease: string }): Promise<Outcome<unknown>>;
  commit(slug: string, body: { generationId: string; fileset: FileSet; overwriteModified: boolean }): Promise<Outcome<unknown>>;
  /** Project VSS file ⇐ its release in vss-catalog (workspace `syncProjectVss`, ADR-0052); `changed` when rewritten. */
  syncVss(slug: string): Promise<Outcome<{ release: string; path: string | null; changed: boolean }>>;
  /** Read-only views of the project folder (workspace tree/file/generations), for the files viewer. */
  workspaceGet(path: string): Promise<Outcome<unknown>>;
  /** Runs a toolchain job to its end; every log line goes to `onLine`. */
  job(language: string, kind: string, project: string, onLine: (l: LogLine) => void, options?: Record<string, unknown>): Promise<ToolchainJob>;
  /** Starts a toolchain job (a `run` is followed separately); 409/422 come back as an outcome. */
  startJob(language: string, kind: string, project: string, options?: Record<string, unknown>): Promise<Outcome<ToolchainJob>>;
  /** Follows a job's log after `afterSeq` until it ends (reconnecting on drops); resolves with the final job. */
  followJob(language: string, jobId: string, afterSeq: number, onLine: (l: LogLine) => void): Promise<ToolchainJob>;
  /** One job of a toolchain (null when unknown). */
  getJob(language: string, jobId: string): Promise<ToolchainJob | null>;
  /** Zip of the project folder plus `extraFiles` (workspace `exportProject`), as the raw response. */
  exportProject(slug: string, body: { generationId?: string; extraFiles: { path: string; content: string }[] }): Promise<Response>;
  /** Actuators whose target the signal-gateway mirrors to the current value (empty = none); `sandbox`: on a run's own databroker (empty = the run ended). */
  mirror(release: string, paths: string[], sandbox?: string): Promise<void>;
  /** Health and version of every service the orchestrator drives (System status, ADR-0033 §4). */
  system(): Promise<ServiceStatus[]>;
  /** App lifecycle on the workspace (ADR-0053): delete is idempotent, clean frees build outputs. */
  workspaceDelete(slug: string): Promise<Outcome<null>>;
  workspaceClean(slug: string): Promise<Outcome<{ freedBytes: number }>>;
  workspaceSize(slug: string): Promise<Outcome<{ bytes: number; buildBytes: number }>>;
  /** Free space of the projects volume and its threshold level (workspace `Capacity`). */
  workspaceCapacity(): Promise<Outcome<WorkspaceCapacity>>;
  /** Per-project toolchain caches of a deleted app; `gc` keeps only the live apps of that language. */
  toolchainForget(language: string, slug: string): Promise<Outcome<null>>;
  toolchainGc(language: string, keep: string[]): Promise<Outcome<{ removed: number; freedBytes: number }>>;
}

export interface WorkspaceCapacity {
  freeBytes: number;
  totalBytes: number;
  level: "ok" | "low" | "high" | "flood";
  thresholds: { lowBytes: number; highBytes: number; floodBytes: number };
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

/** A pooled connection closed under us (Bun: ECONNRESET "socket connection was closed unexpectedly"), not a refusal. */
export function isConnectionReset(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown }; message?: unknown } | null;
  const code = e?.code ?? e?.cause?.code;
  return code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET" || /socket connection was closed unexpectedly/i.test(String(e?.message ?? ""));
}

export function httpClients(e: Endpoints): Clients {
  // The current request id (the request being handled, or the generation the SynCode worker runs).
  const headers = () => ({ ...internalHeaders(undefined, e.secret), "content-type": "application/json" });
  /**
   * `retry`: the call is idempotent (pure, keyed or a read) and is sent once more when the pooled keep-alive connection
   * turns out to be dead — the peer restarted (a rebuilt image, `sv vss use`) and Bun reports "socket connection was
   * closed unexpectedly" before the request reached it. Toolchain job creation is never retried (a job could run twice).
   */
  const call = async (url: string, init: RequestInit = {}, retry = false): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) } });
      } catch (err) {
        if (retry && attempt === 0 && isConnectionReset(err)) continue;
        throw new ServiceUnavailable(`${url}: ${(err as Error).message}`);
      }
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
      const res = await call(`${e.compiler}/compile`, { method: "POST", body: JSON.stringify({ graph, mode: "build", target }) }, true);
      if (!res.ok) throw new ServiceUnavailable(`compiler /compile ⇒ ${res.status}`);
      return (await res.json()) as CompileResult;
    },
    async generate(language, request) {
      return outcome<FileSet>(await call(`${base(e.backends, language, "backend")}/generate`, { method: "POST", body: JSON.stringify(request) }, true));
    },
    async createProject(body) {
      return outcome(await call(`${e.workspace}/projects`, { method: "POST", body: JSON.stringify(body) }, true)); // a repeat answers 409, which the caller accepts
    },
    async workspaceGet(path) {
      return outcome(await call(`${e.workspace}${path}`, {}, true));
    },
    async workspaceDelete(slug) {
      const res = await call(`${e.workspace}/projects/${slug}`, { method: "DELETE" }, true);
      return res.status === 204 ? { ok: true, value: null } : outcome<null>(res);
    },
    async workspaceClean(slug) {
      return outcome(await call(`${e.workspace}/projects/${slug}/clean`, { method: "POST" }, true));
    },
    async workspaceSize(slug) {
      return outcome(await call(`${e.workspace}/projects/${slug}/size`, {}, true));
    },
    async workspaceCapacity() {
      return outcome(await call(`${e.workspace}/capacity`, {}, true));
    },
    async toolchainForget(language, slug) {
      const res = await call(`${base(e.toolchains, language, "toolchain")}/projects/${slug}/forget`, { method: "POST" }, true);
      return res.status === 204 ? { ok: true, value: null } : outcome<null>(res);
    },
    async toolchainGc(language, keep) {
      return outcome(await call(`${base(e.toolchains, language, "toolchain")}/gc`, { method: "POST", body: JSON.stringify({ keep }) }, true));
    },
    async commit(slug, body) {
      return outcome(await call(`${e.workspace}/projects/${slug}/commits`, { method: "POST", body: JSON.stringify(body) }, true)); // keyed by generationId
    },
    async syncVss(slug) {
      return outcome(await call(`${e.workspace}/projects/${slug}/vss-sync`, { method: "POST" }, true));
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
    async mirror(release, paths, sandbox) {
      if (!e.signalGateway) return;
      const res = await call(`${e.signalGateway}/mirror`, { method: "PUT", body: JSON.stringify({ release, paths, ...(sandbox ? { sandbox } : {}) }) }, true);
      if (!res.ok) throw new ServiceUnavailable(`signal-gateway /mirror ⇒ ${res.status}`);
    },
    async getJob(language, jobId) {
      const tc = base(e.toolchains, language, "toolchain");
      const res = await call(`${tc}/jobs/${jobId}`);
      return res.ok ? ((await res.json()) as ToolchainJob) : null;
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
