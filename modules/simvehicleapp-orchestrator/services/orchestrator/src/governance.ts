import type { Clients, WorkspaceCapacity } from "./clients.ts";

/**
 * Host capacity governance (ADR-0053 §B): limits checked *before* an app is created or a SynCode is queued, so a
 * deployment never runs out of disk or build time unnoticed. The orchestrator is the one creator of apps (studio,
 * AI tools, MCP and gates all come through it), so host-wide limits live here; the per-workspace quota lives in the
 * studio BFF, which alone knows workspaces.
 */
export interface Limits {
  /** Apps on the host (`SV_MAX_APPS_TOTAL`). */
  maxAppsTotal: number;
  /** Workflows assigned to one app (`SV_MAX_WORKFLOWS_PER_APP`). */
  maxWorkflowsPerApp: number;
  /** SynCode runs waiting in the queue, all apps (`SV_MAX_QUEUED_GENERATIONS`). */
  maxQueued: number;
  /** Build outputs of an app without SynCode/Run for this long are cleaned (`SV_IDLE_CLEAN_DAYS`; 0 = never). */
  idleCleanMs: number;
  /** A `failed` app older than this is deleted (`SV_FAILED_TTL_DAYS`; 0 = never). */
  failedTtlMs: number;
}

const DAY = 86_400_000;

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): Limits {
  const int = (name: string, fallback: number, min = 0) => {
    const v = Number(env[name]);
    return Number.isFinite(v) && v >= min ? Math.floor(v) : fallback;
  };
  return {
    maxAppsTotal: int("SV_MAX_APPS_TOTAL", 100, 1),
    maxWorkflowsPerApp: int("SV_MAX_WORKFLOWS_PER_APP", 20, 1),
    maxQueued: int("SV_MAX_QUEUED_GENERATIONS", 20, 1),
    idleCleanMs: int("SV_IDLE_CLEAN_DAYS", 14) * DAY,
    failedTtlMs: int("SV_FAILED_TTL_DAYS", 7) * DAY,
  };
}

export interface Diag {
  code: string;
  severity: "error";
  stage: "workspace" | "build";
  message: string;
  docs: string;
  data?: Record<string, unknown>;
}

const diag = (code: string, stage: Diag["stage"], message: string, data?: Record<string, unknown>): Diag => ({ code, severity: "error", stage, message, docs: `diagnostics#${code}`, ...(data ? { data } : {}) });

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export const quotaExceeded = (scope: "host" | "workspace" | "app", limit: number, what: string) =>
  diag("APP_QUOTA_EXCEEDED", "workspace", `${what}: the limit is ${limit}. Delete or reuse an app (Vehicle apps), or ask the administrator to raise it.`, { scope, limit });

export const diskLow = (c: WorkspaceCapacity, blocked: "app" | "syncode") =>
  diag(
    "HOST_DISK_LOW",
    "workspace",
    `Only ${gb(c.freeBytes)} free on the host: ${blocked === "app" ? "no new vehicle app" : "SynCode is paused"} until space is freed. Clean or delete apps you no longer need (Vehicle apps).`,
    { level: c.level, freeBytes: c.freeBytes },
  );

export const queueFull = (limit: number) =>
  diag("SYNCODE_QUEUE_FULL", "build", `${limit} SynCode runs are already waiting: try again in a few minutes.`, { limit });

/**
 * Workspace capacity, cached (`cacheMs`, default 30 s). A failed measurement is `null`: the checks then let the request
 * through (fail open) — users are never blocked because the measure failed — and the caller logs it.
 */
export class CapacityProbe {
  private cached: { at: number; value: WorkspaceCapacity | null } | null = null;
  constructor(
    private readonly clients: Pick<Clients, "workspaceCapacity">,
    private readonly opts: { cacheMs?: number; now?: () => number; onError?: (e: unknown) => void } = {},
  ) {}

  async get(): Promise<WorkspaceCapacity | null> {
    const now = (this.opts.now ?? Date.now)();
    if (this.cached && now - this.cached.at < (this.opts.cacheMs ?? 30_000)) return this.cached.value;
    let value: WorkspaceCapacity | null = null;
    try {
      const r = await this.clients.workspaceCapacity();
      if (r.ok) value = r.value;
      else this.opts.onError?.(new Error(`workspace /capacity ⇒ ${r.status}`));
    } catch (e) {
      this.opts.onError?.(e);
    }
    this.cached = { at: now, value };
    return value;
  }

  /** After a clean/delete the free space changed: measure again on the next check. */
  invalidate(): void {
    this.cached = null;
  }
}
