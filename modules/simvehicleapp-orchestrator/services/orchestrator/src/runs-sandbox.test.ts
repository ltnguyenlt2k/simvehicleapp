import { describe, expect, test } from "bun:test";
import { createOrchestratorHandler } from "./app.ts";
import type { Clients, Outcome, ToolchainJob } from "./clients.ts";
import { EventHub } from "./events.ts";
import { type Generation, initialVerification, type LogLine, MemoryRepo, type Project, STAGES } from "./repo.ts";
import { databrokerApiOf, RunConflict, type RunLimits, RunManager, RunQuota, runLimitsFromEnv } from "./runs.ts";

/** Sandboxed runs (ADR-0057, M17-T04): many runs at once, each on a databroker of its own, within quotas and a time limit. */

const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;
const started = (seq = 0): LogLine => ({ runId: "job", seq, ts: 5, stream: "stdout", level: "info", msg: `SVTRACE ${JSON.stringify({ v: 1, ts: 1, app: "App", ev: "app.started" })}` });

/** A toolchain running many jobs: each run job gets its own sandbox port; `stop` ends the job it names. */
function fakeToolchain() {
  const calls: string[] = [];
  const jobs = new Map<string, { say?: (l: LogLine) => void; end?: (j: ToolchainJob) => void; port: number }>();
  let n = 0;
  const clients = {
    startJob: async (key: string, kind: string, _p: string, options?: Record<string, unknown>): Promise<Outcome<ToolchainJob>> => {
      calls.push(`${key === "cpp" ? "" : `${key}: `}${kind}${options?.sandbox ? " sandbox" : ""}${options?.env ? ` ${JSON.stringify(options.env)}` : ""}${options?.runJobId ? ` ${options.runJobId}` : ""}`);
      if (kind === "stop") {
        const id = options?.runJobId as string;
        queueMicrotask(() => jobs.get(id)?.end?.({ id, state: "cancelled", exitCode: 130, diagnostics: [] }));
        return { ok: true, value: { id: "job-stop", state: "running", exitCode: null, diagnostics: [] } };
      }
      const id = `job-${++n}`;
      jobs.set(id, { port: 56000 + n - 1 });
      return { ok: true, value: { id, state: "running", exitCode: null, diagnostics: [] } };
    },
    getJob: async (_l: string, id: string) => (jobs.has(id) ? { id, state: "running", exitCode: null, diagnostics: [], sandbox: { address: `toolchain-cpp:${jobs.get(id)!.port}` } } : null),
    followJob: (_l: string, id: string, _after: number, cb: (l: LogLine) => void) =>
      new Promise<ToolchainJob>((resolve) => {
        const j = jobs.get(id)!;
        j.say = cb;
        j.end = resolve;
      }),
    mirror: async (release: string, paths: string[], sandbox?: string, api?: string) => void calls.push(`mirror ${release} [${paths.join(",")}]${sandbox ? ` on ${sandbox}` : ""}${api && api !== "sdv.databroker.v1" ? ` ${api}` : ""}`),
    system: async () => [],
  } as unknown as Clients;
  return { clients, calls, start: (jobId: string) => jobs.get(jobId)?.say?.(started()) };
}

const LIMITS: RunLimits = { sandbox: true, perUser: 2, total: 3, maxMinutes: 30, maxExtensions: 3 };

async function setup(limits: Partial<RunLimits> = {}, databrokerApis: Record<string, string> = {}) {
  const repo = new MemoryRepo();
  const hub = new EventHub();
  const tc = fakeToolchain();
  const project = async (slug: string): Promise<Project> =>
    (await repo.createProject({ id: crypto.randomUUID(), slug, name: slug, appName: "App", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: slug, traceLevel: "node" }, status: "ready" }))!;
  const gen = async (p: Project) => {
    const g: Generation = {
      id: `g_${crypto.randomUUID()}`,
      projectId: p.id,
      state: "succeeded",
      stages: STAGES.map((name) => ({ name, state: "passed" })),
      verification: initialVerification(),
      diagnostics: [],
      generatedFiles: [],
      workflows: [],
      runInfo: { traceMap: {}, signals: [{ path: "Vehicle.Body.Lights.Hazard.IsSignaling", vssType: "actuator", dataType: "boolean", access: ["write"] }] },
      request: { graphs: [] },
      createdAt: Date.now(),
    };
    await repo.createGeneration(g);
    return g;
  };
  let n = 0;
  const runs = new RunManager({ repo, clients: tc.clients, hub, databrokers: { "v4.0": "databroker:55555" }, limits: { ...LIMITS, ...limits }, databrokerApis, newId: () => `r_${++n}`, batchMs: 1 });
  return { repo, hub, tc, project, gen, runs };
}

const until = async (cond: () => Promise<boolean> | boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(2);
  }
};

const ann = { userId: "u_ann", workspaceId: "w1" };
const bob = { userId: "u_bob", workspaceId: "w1" };

describe("sandboxed runs (ADR-0057, M17-T04)", () => {
  test("two users run apps at the same time, each on its own databroker; no shared mirror", async () => {
    const { repo, tc, project, gen, runs } = await setup();
    const a = await project("lka");
    const b = await project("comfort");
    const ra = await runs.start(a, (await gen(a)).id, undefined, ann);
    const rb = await runs.start(b, (await gen(b)).id, undefined, bob);
    expect(ra.owner).toEqual(ann);
    // The address is known while the app starts: the gateway mirrors the app's actuators on that databroker only.
    expect(ra.sandbox).toBe("toolchain-cpp:56000");
    expect(tc.calls).toEqual([
      'run sandbox {"SV_TRACE_LEVEL":"node","SV_RUN_ID":"r_1","SV_DATABROKER_API":"sdv.databroker.v1","KUKSA_DATABROKER_API":"sdv.databroker.v1"}',
      "mirror v4.0 [Vehicle.Body.Lights.Hazard.IsSignaling] on toolchain-cpp:56000",
      'run sandbox {"SV_TRACE_LEVEL":"node","SV_RUN_ID":"r_2","SV_DATABROKER_API":"sdv.databroker.v1","KUKSA_DATABROKER_API":"sdv.databroker.v1"}',
      "mirror v4.0 [Vehicle.Body.Lights.Hazard.IsSignaling] on toolchain-cpp:56001",
    ]);
    tc.start("job-1");
    tc.start("job-2");
    await until(async () => (await repo.run("r_2"))!.state === "running" && (await repo.run("r_1"))!.state === "running");
    expect((await repo.run(ra.id))!.sandbox).toBe("toolchain-cpp:56000");
    expect((await repo.run(rb.id))!.sandbox).toBe("toolchain-cpp:56001");
    await runs.stop(ra.id);
    await until(async () => (await repo.run("r_1"))!.state === "stopped");
    expect((await repo.run("r_1"))!.stopReason).toBe("user");
    expect((await repo.run("r_2"))!.state).toBe("running");
    expect(tc.calls).toContain("mirror v4.0 [] on toolchain-cpp:56000"); // the gateway releases the ended run's databroker
    expect(tc.calls).not.toContain("mirror v4.0 [] on toolchain-cpp:56001");
    expect(tc.calls.some((c) => c.startsWith("mirror") && !c.includes(" on "))).toBe(false); // the shared databrokers are untouched
  });

  test("quotas: per user, then for the host, with RUN_QUOTA_EXCEEDED naming the caller's runs; one run per app", async () => {
    const { project, gen, runs } = await setup();
    const apps = await Promise.all(["a1", "a2", "a3", "a4"].map(project));
    const gens = await Promise.all(apps.map(gen));
    const first = await runs.start(apps[0]!, gens[0]!.id, undefined, ann);
    const same = await runs.start(apps[0]!, gens[0]!.id, undefined, bob).catch((e) => e);
    expect(same).toBeInstanceOf(RunConflict);
    expect((same as RunConflict).activeRun?.id).toBe(first.id);
    await runs.start(apps[1]!, gens[1]!.id, undefined, ann);
    const own = await runs.start(apps[2]!, gens[2]!.id, undefined, ann).catch((e) => e);
    expect(own).toBeInstanceOf(RunQuota);
    expect((own as RunQuota).diagnostic).toMatchObject({ code: "RUN_QUOTA_EXCEEDED", data: { scope: "user", limit: 2 } });
    expect((own as RunQuota).own.map((r) => r.id)).toEqual(expect.arrayContaining(["r_1", "r_2"]));
    await runs.start(apps[2]!, gens[2]!.id, undefined, bob);
    const host = await runs.start(apps[3]!, gens[3]!.id, undefined, bob).catch((e) => e);
    expect((host as RunQuota).diagnostic.data).toMatchObject({ scope: "host", limit: 3 });
  });

  test("a run stops by itself at its time limit (stopReason expired); Extend keeps it, at most maxExtensions times", async () => {
    const { repo, tc, project, gen, runs } = await setup({ maxMinutes: 0.002, maxExtensions: 1 }); // 120 ms
    const a = await project("lka");
    const r = await runs.start(a, (await gen(a)).id, undefined, ann);
    await expect(runs.extend(r.id)).rejects.toThrow("Only a running app");
    tc.start("job-1");
    await until(async () => (await repo.run(r.id))!.state === "running");
    const first = (await repo.run(r.id))!.expiresAt!;
    const extended = (await runs.extend(r.id))!;
    expect(extended.extensions).toBe(1);
    expect(extended.expiresAt).toBe(first + 120);
    await expect(runs.extend(r.id)).rejects.toThrow("already extended 1 times");
    await Bun.sleep(150);
    expect((await repo.run(r.id))!.state).toBe("running"); // the extension moved the limit
    await until(async () => (await repo.run(r.id))!.state === "stopped", 1000);
    expect((await repo.run(r.id))!.stopReason).toBe("expired");
    expect(tc.calls).toContain("stop job-1");
  });

  test("HTTP: owner in the start body, 409 RUN_QUOTA_EXCEEDED as a diagnostics array, POST /runs/{rid}/extend", async () => {
    const { repo, hub, tc, project, gen, runs } = await setup({ perUser: 1 });
    const h = createOrchestratorHandler({ repo, clients: tc.clients, hub, runs, kick() {}, background() {} });
    const call = (method: string, path: string, body?: unknown) => h(new Request(`http://o${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
    const a = await project("lka");
    const b = await project("comfort");
    await gen(a);
    await gen(b);
    expect((await call("POST", `/projects/${a.id}/runs`, { owner: { userId: "x y" } })).status).toBe(400);
    const ok = await call("POST", `/projects/${a.id}/runs`, { owner: ann });
    expect(ok.status).toBe(202);
    expect((await ok.json()).owner).toEqual(ann);
    const quota = await call("POST", `/projects/${b.id}/runs`, { owner: ann });
    expect(quota.status).toBe(409);
    const [d] = await quota.json();
    expect(d).toMatchObject({ code: "RUN_QUOTA_EXCEEDED", stage: "run", data: { scope: "user", limit: 1, runs: [{ id: "r_1", projectId: a.id }] } });
    expect((await call("POST", "/runs/r_1/extend")).status).toBe(409); // not running yet
    tc.start("job-1");
    await until(async () => (await repo.run("r_1"))!.state === "running");
    const ext = await call("POST", "/runs/r_1/extend");
    expect(ext.status).toBe(200);
    expect((await ext.json()).extensions).toBe(1);
    const mine = await (await call("GET", `/runs?active=true&ownerUserId=${ann.userId}`)).json();
    expect(mine.runs.map((r: { id: string }) => r.id)).toEqual(["r_1"]);
    expect(mine.limits).toEqual({ ...LIMITS, perUser: 1 });
    expect((await (await call("GET", "/runs?active=true&ownerUserId=u_bob")).json()).runs).toEqual([]);
    expect((await call("GET", "/runs?ownerUserId=x%20y")).status).toBe(400);
    expect((await (await call("POST", "/runs/r_1/stop", { reason: "admin" })).json()).stopReason).toBe("admin");
    expect((await (await call("GET", "/capacity")).json()).runs).toEqual({ active: 1, limit: 3, perUser: 1, sandbox: true, maxMinutes: 30 });
  });

  test("a backend on kuksa.val.v2 (ADR-0047): its app gets SV_DATABROKER_API and the gateway provides its actuators", async () => {
    const { tc, project, gen, runs } = await setup({}, { cpp: "kuksa.val.v2" });
    const a = await project("lka");
    await runs.start(a, (await gen(a)).id, undefined, ann);
    expect(tc.calls).toEqual([
      'run sandbox {"SV_TRACE_LEVEL":"node","SV_RUN_ID":"r_1","SV_DATABROKER_API":"kuksa.val.v2","KUKSA_DATABROKER_API":"kuksa.val.v2"}',
      "mirror v4.0 [Vehicle.Body.Lights.Hazard.IsSignaling] on toolchain-cpp:56000 kuksa.val.v2",
    ]);
  });

  test("a WebAssembly app (ADR-0061) runs on the <language>-wasm toolchain and always over kuksa.val.v2", async () => {
    const { repo, tc, gen, runs } = await setup();
    const w = (await repo.createProject({ id: crypto.randomUUID(), slug: "w", name: "w", appName: "W", language: "cpp", target: "wasm", vssRelease: "v4.0", settings: { mqttTopicPrefix: "w", traceLevel: "node" }, status: "ready" }))!;
    await runs.start(w, (await gen(w)).id, undefined, ann);
    expect(tc.calls[0]).toBe('cpp-wasm: run sandbox {"SV_TRACE_LEVEL":"node","SV_RUN_ID":"r_1","SV_DATABROKER_API":"kuksa.val.v2","KUKSA_DATABROKER_API":"kuksa.val.v2"}');
    expect(tc.calls[1]).toContain("kuksa.val.v2");
  });

  test("databroker API per backend: its entry, else *, else sdv.databroker.v1", () => {
    expect(databrokerApiOf(undefined, "cpp")).toBe("sdv.databroker.v1");
    expect(databrokerApiOf({ "*": "kuksa.val.v2" }, "python")).toBe("kuksa.val.v2");
    expect(databrokerApiOf({ "*": "kuksa.val.v2", cpp: "sdv.databroker.v1" }, "cpp")).toBe("sdv.databroker.v1");
    expect(databrokerApiOf({ rust: "nonsense" }, "rust")).toBe("sdv.databroker.v1");
  });

  test("limits from the environment: sandboxes off unless SV_RUN_SANDBOX=1; bad values fall back", () => {
    expect(runLimitsFromEnv({})).toEqual({ sandbox: false, perUser: 2, total: 20, maxMinutes: 30, maxExtensions: 3 });
    expect(runLimitsFromEnv({ SV_RUN_SANDBOX: "1", SV_MAX_RUNS_PER_USER: "0", SV_MAX_RUNS_TOTAL: "8", SV_RUN_MAX_MINUTES: "0", SV_RUN_MAX_EXTENSIONS: "x" })).toEqual({ sandbox: true, perUser: 2, total: 8, maxMinutes: 0, maxExtensions: 3 });
    expect(runLimitsFromEnv({ SV_RUN_MAX_MINUTES: "0.75" }).maxMinutes).toBe(0.75);
    expect(runLimitsFromEnv({ SV_RUN_MAX_MINUTES: "-1" }).maxMinutes).toBe(30);
  });
});
