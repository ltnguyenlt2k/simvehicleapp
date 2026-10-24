import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fixturesDir } from "@simvehicleapp/contracts";
import { createOrchestratorHandler } from "./app.ts";
import type { Clients, Outcome, WorkspaceCapacity } from "./clients.ts";
import { EventHub } from "./events.ts";
import { CapacityProbe, type Limits, limitsFromEnv } from "./governance.ts";
import { AppBusy, deleteApp, sweep } from "./lifecycle.ts";
import { type Generation, initialVerification, MemoryRepo, type Project, type Run, STAGES } from "./repo.ts";

/** Vehicle app lifecycle and host capacity governance on the orchestrator (ADR-0053, M16-T03). */

const graph = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/graph.json`, "utf8"));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
const GB = 1024 ** 3;
const DAY = 86_400_000;
const cap = (freeGb: number, level: WorkspaceCapacity["level"]): WorkspaceCapacity => ({ freeBytes: freeGb * GB, totalBytes: 100 * GB, level, thresholds: { lowBytes: 10 * GB, highBytes: 5 * GB, floodBytes: 2 * GB } });
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

function clients(over: Partial<Clients> = {}) {
  const calls: string[] = [];
  const c = {
    createProject: async () => (calls.push("ws:create"), ok({})),
    job: async (_l: string, kind: string) => (calls.push(`job:${kind}`), { id: "j", state: "succeeded" as const, exitCode: 0, diagnostics: [] }),
    workspaceDelete: async (slug: string) => (calls.push(`ws:delete:${slug}`), ok(null)),
    workspaceClean: async (slug: string) => (calls.push(`ws:clean:${slug}`), ok({ freedBytes: 1234 })),
    workspaceSize: async () => ok({ bytes: 2000, buildBytes: 1000 }),
    workspaceCapacity: async () => ok(cap(50, "ok")),
    toolchainForget: async (l: string, slug: string) => (calls.push(`tc:forget:${l}:${slug}`), ok(null)),
    toolchainGc: async (l: string, keep: string[]) => (calls.push(`tc:gc:${l}:${keep.join("+")}`), ok({ removed: 1, freedBytes: 500 })),
    openRoute: async (id: string) => (calls.push(`route:open:${id}`), { address: "vehicle-gateway:57000" }),
    closeRoute: async (id: string) => void calls.push(`route:close:${id}`),
    routeAudit: async () => ({ audit: [], forwarded: {} }),
    probeTarget: async () => ({ reachable: true, api: "kuksa.val.v2", server: { name: "databroker", version: "0.5.0" }, missing: [] }),
    ...over,
  } as unknown as Clients;
  return { clients: c, calls };
}

async function app(repo: MemoryRepo, slug: string, status: Project["status"] = "ready", language: Project["language"] = "cpp") {
  const p = await repo.createProject({ id: crypto.randomUUID(), slug, name: slug, appName: "App", language, vssRelease: "v4.0", settings: { mqttTopicPrefix: `x/${slug}`, traceLevel: "node" }, status });
  return p;
}
function generation(projectId: string, state: Generation["state"], createdAt = Date.now()): Generation {
  return { id: `g_${crypto.randomUUID()}`, projectId, state, stages: STAGES.map((name) => ({ name, state: "pending" })), verification: initialVerification(), diagnostics: [], generatedFiles: [], workflows: [], request: { graphs: [graph] }, createdAt };
}
function run(projectId: string, state: Run["state"]): Run {
  return { id: `r_${crypto.randomUUID()}`, projectId, generationId: "g", state, vssRelease: "v4.0", traceLevel: "node", diagnostics: [], createdAt: Date.now() };
}
/** A RunManager whose stop ends the run at once (the real one is covered by runs.test.ts). */
const stopper = (repo: MemoryRepo) => ({ stop: async (id: string) => (await repo.updateRun(id, { state: "stopped" }), null) }) as never;

const limits = (over: Partial<Limits> = {}): Limits => ({ ...limitsFromEnv({}), ...over });
function handler(repo: MemoryRepo, c: Clients, over: { limits?: Partial<Limits>; capacity?: WorkspaceCapacity | null; runs?: never } = {}) {
  const probe = new CapacityProbe({ workspaceCapacity: async () => (over.capacity === null ? ({ ok: false, status: 503, diagnostics: [] } as Outcome<WorkspaceCapacity>) : ok(over.capacity ?? cap(50, "ok"))) });
  const bg: Promise<void>[] = [];
  const h = createOrchestratorHandler({ repo, clients: c, hub: new EventHub(), runs: over.runs ?? stopper(repo), limits: limits(over.limits), probe, kick() {}, background: (p) => void bg.push(p) });
  const call = (method: string, path: string, body?: unknown) =>
    h(new Request(`http://o${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
  return { call, bg };
}

describe("limits from the environment", () => {
  test("defaults and invalid values", () => {
    expect(limitsFromEnv({})).toEqual({ maxAppsTotal: 100, maxWorkflowsPerApp: 20, maxQueued: 20, idleCleanMs: 14 * DAY, failedTtlMs: 7 * DAY });
    expect(limitsFromEnv({ SV_MAX_APPS_TOTAL: "0", SV_IDLE_CLEAN_DAYS: "0", SV_MAX_QUEUED_GENERATIONS: "x" })).toMatchObject({ maxAppsTotal: 100, idleCleanMs: 0, maxQueued: 20 });
  });
});

describe("delete", () => {
  test("cancels queued SynCode, stops the run, removes folder + caches + rows (cascade)", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "a1");
    const keep = await app(repo, "keep");
    const q = generation(p.id, "queued");
    await repo.createGeneration(q);
    const r = run(p.id, "running");
    await repo.createRun(r);
    const { clients: c, calls } = clients();
    const { call } = handler(repo, c);
    expect((await call("DELETE", `/projects/${p.id}`)).status).toBe(204);
    expect(await repo.project(p.id)).toBeNull();
    expect(await repo.generation(q.id)).toBeNull();
    expect(await repo.run(r.id)).toBeNull();
    expect(calls).toEqual(["ws:delete:a1", "tc:forget:cpp:a1"]);
    expect(await repo.project(keep.id)).not.toBeNull();
    expect((await call("DELETE", `/projects/${p.id}`)).status).toBe(404);
  });

  test("a building SynCode ⇒ 409 and nothing removed", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "busy");
    await repo.createGeneration(generation(p.id, "running"));
    const { clients: c, calls } = clients();
    const r = await handler(repo, c).call("DELETE", `/projects/${p.id}`);
    expect(r.status).toBe(409);
    expect((await r.json()).message).toContain("building");
    expect(calls).toEqual([]);
    expect(await repo.project(p.id)).not.toBeNull();
  });

  test("the worker claiming a queued SynCode during the delete is caught (no half delete)", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "race");
    const q = generation(p.id, "queued");
    await repo.createGeneration(q);
    // the worker claims it between the list and the cancel
    const cancel = repo.cancelQueued.bind(repo);
    repo.cancelQueued = async (id, at) => (await repo.updateGeneration(id, { state: "running" }), cancel(id, at));
    const { clients: c } = clients();
    await expect(deleteApp({ repo, clients: c, runs: stopper(repo) }, p)).rejects.toBeInstanceOf(AppBusy);
    expect(await repo.project(p.id)).not.toBeNull();
  });

  test("workspace failure keeps the rows (a retry finishes); toolchain failure does not block", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "ws-down");
    const down = clients({ workspaceDelete: async () => ({ ok: false, status: 503, diagnostics: [] }) });
    expect((await handler(repo, down.clients).call("DELETE", `/projects/${p.id}`)).status).toBe(502);
    expect(await repo.project(p.id)).not.toBeNull();
    const tcDown = clients({ toolchainForget: async () => { throw new Error("toolchain down"); } });
    expect((await handler(repo, tcDown.clients).call("DELETE", `/projects/${p.id}`)).status).toBe(204);
    expect(await repo.project(p.id)).toBeNull();
  });

  test("a run that does not stop ⇒ 409 after the wait", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "stuck");
    await repo.createRun(run(p.id, "running"));
    const { clients: c } = clients();
    let t = 0;
    const neverStops = { stop: async () => null } as never;
    await expect(deleteApp({ repo, clients: c, runs: neverStops, now: () => t, sleep: async (ms) => void (t += ms) }, p)).rejects.toThrow("did not stop");
  });
});

describe("clean and repair", () => {
  test("clean frees the build, marks dependencies to reinstall; refused while busy", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "c1");
    await repo.updateProject(p.id, { depsInstalled: true });
    const { clients: c } = clients();
    const { call } = handler(repo, c);
    const r = await call("POST", `/projects/${p.id}/clean`);
    expect(await r.json()).toEqual({ freedBytes: 1234 });
    expect((await repo.project(p.id))!.depsInstalled).toBe(false);
    await repo.createRun(run(p.id, "running"));
    expect((await call("POST", `/projects/${p.id}/clean`)).status).toBe(409);
  });

  test("repair: only a failed app; re-provisions it (folder removed first, workflows kept)", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "broken", "failed");
    await repo.setWorkflows(p.id, [{ simWorkflowId: "wf1", enabled: true }]);
    const ready = await app(repo, "fine");
    const { clients: c, calls } = clients();
    const { call, bg } = handler(repo, c);
    expect((await call("POST", `/projects/${ready.id}/repair`)).status).toBe(409);
    const r = await call("POST", `/projects/${p.id}/repair`);
    expect(r.status).toBe(202);
    expect((await r.json()).status).toBe("creating");
    await Promise.all(bg);
    const after = (await repo.project(p.id))!;
    expect(after.status).toBe("ready");
    expect(after.workflows).toEqual([{ simWorkflowId: "wf1", enabled: true }]);
    expect(calls).toEqual(["ws:delete:broken", "tc:forget:cpp:broken", "ws:create", "job:init"]);
  });
});

describe("quota and disk thresholds", () => {
  const body = (slug: string) => ({ slug, name: slug, language: "cpp", vssRelease: "v4.0" });

  test("host app quota ⇒ 409 APP_QUOTA_EXCEEDED (scope host)", async () => {
    const repo = new MemoryRepo();
    const { clients: c } = clients();
    const { call } = handler(repo, c, { limits: { maxAppsTotal: 2 } });
    expect((await call("POST", "/projects", body("q1"))).status).toBe(201);
    expect((await call("POST", "/projects", body("q2"))).status).toBe(201);
    const r = await call("POST", "/projects", body("q3"));
    expect(r.status).toBe(409);
    const [d] = await r.json();
    expect(d).toMatchObject({ code: "APP_QUOTA_EXCEEDED", stage: "workspace", data: { scope: "host", limit: 2 } });
  });

  test("disk: low warns only, high blocks new apps, flood blocks SynCode; a failed measure lets through", async () => {
    for (const [level, create, syncode] of [["ok", 201, 202], ["low", 201, 202], ["high", 507, 202], ["flood", 507, 507]] as const) {
      const repo = new MemoryRepo();
      const p = await app(repo, "ready-app");
      const { clients: c } = clients();
      const { call } = handler(repo, c, { capacity: cap(level === "flood" ? 1 : level === "high" ? 3 : level === "low" ? 8 : 50, level) });
      const r = await call("POST", "/projects", body(`n-${level}`));
      expect([level, r.status]).toEqual([level, create]);
      if (r.status === 507) expect((await r.json())[0]).toMatchObject({ code: "HOST_DISK_LOW", data: { level } });
      expect([level, (await call("POST", `/projects/${p.id}/generations`, { graphs: [graph] })).status]).toEqual([level, syncode]);
    }
    const repo = new MemoryRepo();
    const { clients: c } = clients();
    expect((await handler(repo, c, { capacity: null }).call("POST", "/projects", body("open"))).status).toBe(201);
  });

  test("more enabled workflows than the per-app limit ⇒ 409 (scope app)", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "wf");
    const { clients: c } = clients();
    const { call } = handler(repo, c, { limits: { maxWorkflowsPerApp: 2 } });
    const wfs = (n: number, enabled = true) => ({ workflows: Array.from({ length: n }, (_, i) => ({ simWorkflowId: `w${i}`, enabled })) });
    expect((await call("PUT", `/projects/${p.id}/workflows`, wfs(2))).status).toBe(200);
    const r = await call("PUT", `/projects/${p.id}/workflows`, wfs(3));
    expect(r.status).toBe(409);
    expect((await r.json())[0].data).toEqual({ scope: "app", limit: 2 });
    expect((await call("PUT", `/projects/${p.id}/workflows`, wfs(5, false))).status).toBe(200); // disabled ones do not count
  });
});

describe("SynCode queue", () => {
  test("an app not ready ⇒ 409 not_ready", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "creating", "creating");
    const { clients: c } = clients();
    const r = await handler(repo, c).call("POST", `/projects/${p.id}/generations`, { graphs: [graph] });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("not_ready");
  });

  test("a newer SynCode of the same app replaces its queued one; the queue is bounded (429)", async () => {
    const repo = new MemoryRepo();
    const a = await app(repo, "qa");
    const b = await app(repo, "qb");
    const { clients: c } = clients();
    const { call } = handler(repo, c, { limits: { maxQueued: 1 } });
    const first = await (await call("POST", `/projects/${a.id}/generations`, { graphs: [graph] })).json();
    const second = await (await call("POST", `/projects/${a.id}/generations`, { graphs: [graph] })).json();
    expect((await repo.generation(first.id))!.state).toBe("cancelled");
    expect((await repo.generation(second.id))!.state).toBe("queued");
    const full = await call("POST", `/projects/${b.id}/generations`, { graphs: [graph] });
    expect(full.status).toBe(429);
    expect((await full.json())[0]).toMatchObject({ code: "SYNCODE_QUEUE_FULL", stage: "build", data: { limit: 1 } });
  });

  test("GET /projects/{id}/size relays the workspace", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "sized");
    const { clients: c } = clients();
    const r = await handler(repo, c).call("GET", `/projects/${p.id}/size`);
    expect(await r.json()).toEqual({ bytes: 2000, buildBytes: 1000 });
  });

  test("GET /capacity", async () => {
    const repo = new MemoryRepo();
    const a = await app(repo, "cap-a");
    await repo.createGeneration(generation(a.id, "queued"));
    const { clients: c } = clients();
    const r = await handler(repo, c, { limits: { maxAppsTotal: 10, maxQueued: 5 } }).call("GET", "/capacity");
    expect(await r.json()).toEqual({ disk: cap(50, "ok"), apps: { total: 1, limit: 10 }, queue: { queued: 1, limit: 5 } });
  });
});

describe("capacity probe", () => {
  test("cached for 30 s, invalidated after a clean/delete", async () => {
    let n = 0;
    let t = 0;
    const probe = new CapacityProbe({ workspaceCapacity: async () => (n++, ok(cap(50, "ok"))) }, { now: () => t });
    await probe.get();
    t = 29_000;
    await probe.get();
    expect(n).toBe(1);
    t = 31_000;
    await probe.get();
    expect(n).toBe(2);
    probe.invalidate();
    await probe.get();
    expect(n).toBe(3);
  });
});

describe("POST /sweep", () => {
  test("runs the sweeper now and answers its result; 409 while one runs; 503 without a sweeper", async () => {
    const result = { deleted: ["a"], cleaned: [], skipped: [], freedBytes: 10, cachesRemoved: 0, errors: [] };
    const answers = [result, null];
    const h = createOrchestratorHandler({ repo: new MemoryRepo(), clients: clients().clients, hub: new EventHub(), limits: limits(), kick() {}, background() {}, sweep: async () => answers.shift() ?? null });
    const call = () => h(new Request("http://o/sweep", { method: "POST" }), ctx);
    const first = await call();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(result);
    expect((await call()).status).toBe(409);
    const none = createOrchestratorHandler({ repo: new MemoryRepo(), clients: clients().clients, hub: new EventHub(), limits: limits(), kick() {}, background() {} });
    expect((await none(new Request("http://o/sweep", { method: "POST" }), ctx)).status).toBe(503);
  });
});

describe("sweeper", () => {
  test("deletes old failed apps, cleans idle ones, collects caches; recent, running and SynCoding apps untouched", async () => {
    const repo = new MemoryRepo();
    const old = Date.now() - 30 * DAY;
    const failedOld = await app(repo, "failed-old", "failed");
    const failedNew = await app(repo, "failed-new", "failed");
    const idle = await app(repo, "idle");
    const active = await app(repo, "active", "ready", "python");
    const busy = await app(repo, "busy-idle");
    for (const p of [failedOld, idle, busy]) Object.assign(repo.projectsById.get(p.id)!, { createdAt: old, updatedAt: old });
    await repo.createGeneration(generation(active.id, "succeeded", Date.now()));
    await repo.createRun({ ...run(busy.id, "running"), createdAt: old });
    const { clients: c, calls } = clients();
    const r = await sweep({ repo, clients: c, runs: stopper(repo) }, limits());
    expect(r.deleted).toEqual(["failed-old"]);
    expect(r.cleaned).toEqual(["idle"]);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual(["busy-idle"]);
    expect(await repo.project(failedNew.id)).not.toBeNull();
    expect(calls.filter((x) => x.startsWith("tc:gc")).sort()).toEqual(["tc:gc:cpp:failed-new+idle+active+busy-idle", "tc:gc:python:failed-new+idle+active+busy-idle"]);
    expect(r.cachesRemoved).toBe(2);
    expect(r.freedBytes).toBe(1234 + 2 * 500);
  });

  test("one app failing does not stop the sweep (reported in errors)", async () => {
    const repo = new MemoryRepo();
    const a = await app(repo, "boom", "failed");
    const b = await app(repo, "other", "failed");
    for (const p of [a, b]) Object.assign(repo.projectsById.get(p.id)!, { createdAt: 0, updatedAt: 0 });
    const { clients: c } = clients({ workspaceDelete: async (slug) => (slug === "boom" ? { ok: false, status: 503, diagnostics: [] } : ok(null)) });
    const r = await sweep({ repo, clients: c }, limits());
    expect(r.deleted).toEqual(["other"]);
    expect(r.errors).toEqual(["boom: workspace could not delete boom (503)"]);
  });

  test("TTL 0 disables both rules", async () => {
    const repo = new MemoryRepo();
    const p = await app(repo, "f", "failed");
    Object.assign(repo.projectsById.get(p.id)!, { createdAt: 0, updatedAt: 0 });
    const { clients: c } = clients();
    const r = await sweep({ repo, clients: c }, limits({ failedTtlMs: 0, idleCleanMs: 0 }));
    expect(r.deleted).toEqual([]);
  });
});
