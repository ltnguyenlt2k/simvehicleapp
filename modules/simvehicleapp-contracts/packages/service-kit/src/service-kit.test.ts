import { describe, expect, test } from "bun:test";
import { ContractValidator } from "@simvehicleapp/contracts";
import { createLogger, createService, internalHeaders, isInternalRequest, Metrics, requestIdOf } from "./index.ts";

const contracts = new ContractValidator();
const SECRET = "s3cret-value";

function harness(handler?: Parameters<typeof createService>[1], checks?: () => Record<string, "ok" | "fail">) {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ service: "compiler", write: (l) => lines.push(JSON.parse(l)), now: () => 1759200000000 });
  const fetch = createService({ name: "compiler", version: "0.1.0", commit: "abc1234", secret: SECRET, logger, checks }, handler ?? (() => new Response("ok")));
  return { fetch, lines };
}
const req = (path: string, headers: Record<string, string> = {}, method = "GET") => new Request(`http://compiler:4020${path}`, { method, headers });

describe("public endpoints", () => {
  test("/version matches ServiceInfo v1 and needs no auth", async () => {
    const res = await harness().fetch(req("/version"));
    expect(res.status).toBe(200);
    const body = await res.json();
    contracts.assert("service-info", body);
    expect(body).toEqual({ name: "compiler", version: "0.1.0", commit: "abc1234", contracts: "1.0.0-alpha.1" });
  });

  test("/healthz ok, and 503 degraded when a check fails", async () => {
    expect(await (await harness().fetch(req("/healthz"))).json()).toEqual({ status: "ok" });
    const res = await harness(undefined, () => ({ db: "ok", catalog: "fail" })).fetch(req("/healthz"));
    expect(res.status).toBe(503);
    const body = await res.json();
    contracts.assert("service-info#/$defs/health", body);
    expect(body.status).toBe("degraded");
  });
});

describe("internal auth (fail closed)", () => {
  test("missing, wrong and correct secret", async () => {
    const { fetch } = harness();
    expect((await fetch(req("/compile", {}, "POST"))).status).toBe(401);
    expect((await fetch(req("/compile", { "x-sv-internal": "nope" }, "POST"))).status).toBe(401);
    expect((await fetch(req("/compile", { "x-sv-internal": SECRET }, "POST"))).status).toBe(200);
  });

  test("empty configured secret denies everything", () => {
    expect(isInternalRequest(req("/x", { "x-sv-internal": "" }), "")).toBe(false);
    expect(isInternalRequest(req("/x", { "x-sv-internal": "a" }), undefined)).toBe(false);
  });
});

describe("request id + logs", () => {
  test("propagates a valid incoming id, replaces a malformed one", () => {
    expect(requestIdOf(req("/", { "x-sv-request-id": "abc-123" }))).toBe("abc-123");
    const generated = requestIdOf(req("/", { "x-sv-request-id": "bad id;INJECT" }));
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("response echoes the id and the access log is one JSON line", async () => {
    const { fetch, lines } = harness();
    const res = await fetch(req("/compile", { ...internalHeaders("rid-1", SECRET) }, "POST"));
    expect(res.headers.get("x-sv-request-id")).toBe("rid-1");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", service: "compiler", msg: "request", requestId: "rid-1", status: 200, path: "/compile" });
  });

  test("unhandled errors return 500 without stack trace; details only in the log", async () => {
    const { fetch, lines } = harness(() => {
      throw new Error("boom at /secret/path");
    });
    const res = await fetch(req("/compile", internalHeaders("rid-2", SECRET), "POST"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("boom");
    expect(JSON.parse(text)).toEqual({ error: "internal_error", requestId: "rid-2" });
    expect(lines[0]).toMatchObject({ level: "error", err: { message: "boom at /secret/path" } });
  });

  test("bigint fields are logged as decimal strings and level filter applies", () => {
    const out: string[] = [];
    const log = createLogger({ service: "x", level: "warn", write: (l) => out.push(l), now: () => 0 });
    log.info("hidden");
    log.warn("odo", { value: 9223372036854775807n, text: "a\nb" });
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain("\n");
    expect(JSON.parse(out[0]!).value).toBe("9223372036854775807");
  });
});

describe("metrics (ADR-0033 §2)", () => {
  test("Prometheus text: counters, gauges, histograms; HTTP requests by route and status class, never ids", async () => {
    const metrics = new Metrics();
    const stages = metrics.histogram("stage_duration_ms", "Stage duration.", [100, 1000]);
    metrics.counter("generations_total", "Generations.").inc({ result: "failed", code: "BUILD_FAILED" });
    metrics.gauge("runs_active", "Active runs.", () => 1);
    stages.observe({ stage: "build" }, 250);
    stages.observe({ stage: "build" }, 50);
    const svc = createService({ name: "x", version: "1", secret: "s", metrics, logger: createLogger({ service: "x", write: () => {} }) }, () => new Response("ok"));
    await svc(new Request("http://x/projects/abc123", { headers: { "x-sv-internal": "s" } }));
    await svc(new Request("http://x/projects/def456"));
    const res = await svc(new Request("http://x/metrics"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('sv_generations_total{code="BUILD_FAILED",result="failed"} 1');
    expect(text).toContain("sv_runs_active 1");
    expect(text).toContain('sv_stage_duration_ms_bucket{le="100",stage="build"} 1');
    expect(text).toContain('sv_stage_duration_ms_bucket{le="+Inf",stage="build"} 2');
    expect(text).toContain('sv_stage_duration_ms_sum{stage="build"} 300');
    expect(text).toContain('sv_http_requests_total{method="GET",route="/projects",status="2xx"} 1');
    expect(text).toContain('sv_http_requests_total{method="GET",route="/projects",status="4xx"} 1');
    expect(text).not.toContain("abc123");
  });

  test("without a registry /metrics is an ordinary (authenticated) path", async () => {
    const svc = createService({ name: "x", version: "1", secret: "s", logger: createLogger({ service: "x", write: () => {} }) }, () => new Response("handler"));
    expect((await svc(new Request("http://x/metrics"))).status).toBe(401);
  });
});
