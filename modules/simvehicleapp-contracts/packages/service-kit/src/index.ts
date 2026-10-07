// Infrastructure only — no business logic (ADR-0007 Implementation, module rule "service-kit").
import { createHash, timingSafeEqual } from "node:crypto";
import { CONTRACTS_VERSION, type ServiceHealth, type ServiceInfoV1 } from "@simvehicleapp/contracts";
import { Metrics } from "./metrics.ts";

export { type Counter, type Histogram, type Labels, Metrics } from "./metrics.ts";

export const INTERNAL_AUTH_HEADER = "x-sv-internal";
export const REQUEST_ID_HEADER = "x-sv-request-id";
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const PUBLIC_PATHS = new Set(["/healthz", "/version"]);

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  service: string;
  level?: LogLevel;
  /** Defaults to stdout; one JSON object per line. */
  write?: (line: string) => void;
  now?: () => number;
}

/** One-line JSON logger: `{"ts","level","service","msg",...fields}`. Newlines inside values stay escaped. */
export function createLogger(opts: LoggerOptions, bound: Record<string, unknown> = {}): Logger {
  const min = LEVELS[opts.level ?? (process.env.SV_LOG_LEVEL as LogLevel | undefined) ?? "info"] ?? LEVELS.info;
  const write = opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = opts.now ?? Date.now;
  const log = (level: LogLevel) => (msg: string, fields: Record<string, unknown> = {}) => {
    if (LEVELS[level] < min) return;
    write(JSON.stringify({ ...bound, ...fields, ts: now(), level, service: opts.service, msg }, jsonSafe));
  };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (fields) => createLogger(opts, { ...bound, ...fields }),
  };
}

function jsonSafe(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString(); // int64/uint64 as decimal strings (ADR-0018 §7)
  if (value instanceof Error) return { name: value.name, message: value.message };
  return value;
}

export interface VersionOptions {
  name: string;
  version: string;
  /** Defaults to env SV_COMMIT, else "unknown". */
  commit?: string;
  extra?: Record<string, string | number | boolean>;
}

export function versionInfo(opts: VersionOptions): ServiceInfoV1 {
  const commit = opts.commit ?? process.env.SV_COMMIT ?? "unknown";
  return { ...opts.extra, name: opts.name, version: opts.version, commit, contracts: CONTRACTS_VERSION };
}

/** Constant-time check of the `x-sv-internal` header. An empty/missing secret denies everything (fail closed). */
export function isInternalRequest(req: Request, secret: string | undefined): boolean {
  const got = req.headers.get(INTERNAL_AUTH_HEADER);
  if (!secret || !got) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest(); // equal length, no length leak
  return timingSafeEqual(digest(got), digest(secret));
}

/** Incoming `x-sv-request-id` when well-formed, else a new UUID. */
export function requestIdOf(req: Request): string {
  const id = req.headers.get(REQUEST_ID_HEADER);
  return id && REQUEST_ID.test(id) ? id : crypto.randomUUID();
}

/** Headers to forward on calls to other internal services. */
export function internalHeaders(requestId: string, secret: string): Record<string, string> {
  return { [INTERNAL_AUTH_HEADER]: secret, [REQUEST_ID_HEADER]: requestId };
}

export interface RequestContext {
  requestId: string;
  log: Logger;
}

export interface ServiceOptions extends VersionOptions {
  /** INTERNAL_API_SECRET; defaults to env. */
  secret?: string;
  logger?: Logger;
  /** Readiness checks reported by /healthz; any "fail" ⇒ 503 degraded. */
  checks?: () => Promise<Record<string, "ok" | "fail">> | Record<string, "ok" | "fail">;
  /**
   * Registry served at `GET /metrics` (Prometheus text, ADR-0033 §2), with HTTP request counts and
   * durations added; absent ⇒ no /metrics. Like /healthz it needs no internal header: services are
   * only reachable on the internal network and 127.0.0.1, and metrics carry no ids or payloads.
   */
  metrics?: Metrics;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/**
 * Wraps a service handler with /healthz, /version, internal auth, request ids and access logs.
 * Unhandled errors become a plain 500 without stack traces (ADR-0016 §4); details go to the log.
 */
export function createService(
  opts: ServiceOptions,
  handler: (req: Request, ctx: RequestContext) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  const secret = opts.secret ?? process.env.INTERNAL_API_SECRET;
  const logger = opts.logger ?? createLogger({ service: opts.name });
  const info = versionInfo(opts);
  const httpRequests = opts.metrics?.counter("http_requests_total", "HTTP requests by method, route and status class.");
  const httpDuration = opts.metrics?.histogram("http_request_duration_ms", "HTTP request duration (ms; streams: until the response starts).");

  return async (req) => {
    const requestId = requestIdOf(req);
    const log = logger.child({ requestId });
    const path = new URL(req.url).pathname;
    const started = performance.now();
    let res: Response;
    try {
      if (req.method === "GET" && path === "/version") res = json(200, info);
      else if (req.method === "GET" && path === "/metrics" && opts.metrics) res = new Response(opts.metrics.render(), { headers: { "content-type": "text/plain; version=0.0.4" } });
      else if (req.method === "GET" && path === "/healthz") {
        const checks = opts.checks ? await opts.checks() : undefined;
        const failed = checks && Object.values(checks).includes("fail");
        const body: ServiceHealth = checks ? { status: failed ? "degraded" : "ok", checks } : { status: "ok" };
        res = json(failed ? 503 : 200, body);
      } else if (!PUBLIC_PATHS.has(path) && !isInternalRequest(req, secret)) res = json(401, { error: "unauthorized" });
      else res = await handler(req, { requestId, log });
    } catch (err) {
      log.error("unhandled error", { err, path });
      res = json(500, { error: "internal_error", requestId });
    }
    res.headers.set(REQUEST_ID_HEADER, requestId);
    if (httpRequests && path !== "/metrics" && path !== "/healthz") {
      // Route = first path segment (ids never become labels).
      const labels = { method: req.method, route: `/${path.split("/")[1] ?? ""}`, status: `${Math.floor(res.status / 100)}xx` };
      httpRequests.inc(labels);
      httpDuration!.observe({ method: req.method, route: labels.route }, Math.round(performance.now() - started));
    }
    if (path !== "/healthz") log.info("request", { method: req.method, path, status: res.status, ms: Math.round(performance.now() - started) });
    return res;
  };
}
