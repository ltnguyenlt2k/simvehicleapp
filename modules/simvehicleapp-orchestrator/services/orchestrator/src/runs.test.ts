import { describe, expect, test } from "bun:test";
import { createOrchestratorHandler } from "./app.ts";
import type { Clients, Outcome, ToolchainJob } from "./clients.ts";
import { EventHub } from "./events.ts";
import { type Generation, initialVerification, type LogLine, MemoryRepo, type Project, type RunEvent, STAGES } from "./repo.ts";
import { RunConflict, RunManager } from "./runs.ts";
import { levelOf, TraceIngest } from "./trace.ts";

const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;
const line = (msg: string, seq = 0, stream: LogLine["stream"] = "stdout"): LogLine => ({ runId: "job", seq, ts: 5, stream, level: "info", msg });
const svtrace = (o: Record<string, unknown>) => `SVTRACE ${JSON.stringify({ v: 1, ts: 1759200000125, app: "App", ...o })}`;
const traceMap = { gw_a: { n1: "b1", n2: "b2", n3: "b3" } };

function ingest(opts: Partial<ConstructorParameters<typeof TraceIngest>[0]> = {}) {
  const out: RunEvent[] = [];
  const lifecycle: string[] = [];
  let t = 0;
  const i = new TraceIngest({ runId: "r1", traceMap, emit: (e) => out.push(...e), onLifecycle: (ev) => lifecycle.push(ev), now: () => t, batchMs: 1, ...opts });
  return { i, out, lifecycle, tick: (ms: number) => (t += ms) };
}

describe("TraceIngest (M08-T05, ADR-0027 §2–5)", () => {
  test("SVTRACE lines (even after ANSI codes) become TraceEvents mapped to blocks; the rest are logs with a level", () => {
    const { i, out, lifecycle } = ingest();
    i.line(line(`\x1b[0m${svtrace({ ev: "app.started" })}`));
    i.line(line(svtrace({ wf: "gw_a", run: 1, node: "n2", ev: "enter" })));
    i.line(line("2026-10-07 [ERROR] could not connect"));
    i.line(line("SVTRACE {not json"));
    i.line(line(svtrace({ wf: "gw_a", run: 1, node: "n9", ev: "exit" })));
    i.flush();
    expect(lifecycle).toEqual(["app.started"]);
    expect(out.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(out[0]).toMatchObject({ kind: "trace", body: { runId: "r1", seq: 0, ev: "app.started" } });
    expect(out[1]).toMatchObject({ kind: "trace", body: { wf: "gw_a", run: 1, node: "n2", blockId: "b2", ev: "enter" } });
    expect(out[2]).toMatchObject({ kind: "log", body: { level: "error", msg: "2026-10-07 [ERROR] could not connect" } });
    expect(out[3]).toMatchObject({ kind: "log", body: { msg: "SVTRACE {not json" } });
    expect((out[4]!.body as { blockId?: string }).blockId).toBeUndefined();
  });

  test("log levels of SDK lines", () => {
    expect(levelOf("[WARN] slow", "info")).toBe("warn");
    expect(levelOf("ERROR: x", "info")).toBe("error");
    expect(levelOf("plain text", "info")).toBe("info");
    expect(levelOf("informative", "info")).toBe("info");
  });

  test("events go out in batches", async () => {
    const out: RunEvent[][] = [];
    const i = new TraceIngest({ runId: "r1", traceMap, emit: (e) => out.push(e), batchMs: 20 });
    for (let k = 0; k < 5; k++) i.line(line(`log ${k}`));
    expect(out).toHaveLength(0);
    await Bun.sleep(40);
    expect(out).toHaveLength(1);
    expect(out[0]!.map((e) => (e.body as LogLine).msg)).toEqual(["log 0", "log 1", "log 2", "log 3", "log 4"]);
  });

  test("load: 2 000 ev/s for 10 s — sampling keeps the stream bounded and the counts exact", () => {
    const { i, out, tick } = ingest({ sampleLimit: 500, batchMs: 1_000_000 });
    const started = performance.now();
    let flushed = 0;
    for (let s = 0; s < 10; s++) {
      for (let k = 0; k < 2000; k++) {
        const node = `n${(k % 2) + 2}`;
        i.line(line(svtrace({ wf: "gw_a", run: s * 2000 + k, node, ev: k % 4 < 2 ? "enter" : "exit" })));
        if (k % 100 === 99) {
          tick(50);
          i.flush(); // one batch per 50 ms, as in production
          flushed++;
        }
      }
    }
    i.flush();
    const elapsed = performance.now() - started;
    const traces = out.filter((e) => e.kind === "trace").map((e) => e.body as { node: string; ev: string; data?: { dropped?: number } });
    const count = (node: string, ev: string) => traces.filter((t) => t.node === node && t.ev === ev).reduce((n, t) => n + 1 + (t.data?.dropped ?? 0), 0);
    expect(count("n2", "enter") + count("n3", "enter")).toBe(10_000);
    expect(count("n2", "exit") + count("n3", "exit")).toBe(10_000);
    // 500 events per second pass as they are, the rest is at most 4 coalesced events per batch.
    expect(traces.length).toBeLessThanOrEqual(10 * 500 + flushed * 4 + 4);
    expect(traces.length).toBeLessThan(20_000 / 2);
    expect(elapsed).toBeLessThan(5_000); // 20 000 lines, schema-validated, well under the 10 s they span
  });
});

/** Scripted toolchain: the run job's lines are pushed by the test; the job ends when the test says. */
function fakeToolchain() {
  const calls: string[] = [];
  let onLine: ((l: LogLine) => void) | null = null;
  let end: ((j: ToolchainJob) => void) | null = null;
  let seq = 0;
  const clients = {
    startJob: async (_l: string, kind: string, _p: string, options?: Record<string, unknown>): Promise<Outcome<ToolchainJob>> => {
      calls.push(`${kind}${options?.env ? ` ${JSON.stringify(options.env)}` : ""}${options?.runJobId ? ` ${options.runJobId}` : ""}`);
      if (kind === "stop") queueMicrotask(() => end?.({ id: "job-run", state: "cancelled", exitCode: 130, diagnostics: [] }));
      return { ok: true, value: { id: `job-${kind}`, state: "running", exitCode: null, diagnostics: [] } };
    },
    followJob: (_l: string, _id: string, _after: number, cb: (l: LogLine) => void) =>
      new Promise<ToolchainJob>((resolve) => {
        onLine = cb;
        end = resolve;
      }),
    mirror: async (release: string, paths: string[]) => void calls.push(`mirror ${release} [${paths.join(",")}]`),
  } as unknown as Clients;
  return {
    clients,
    calls,
    say: (msg: string) => onLine?.(line(msg, seq++)),
    exit: (code: number) => end?.({ id: "job-run", state: code === 0 ? "succeeded" : "failed", exitCode: code, diagnostics: [] }),
  };
}

async function setup(startTimeoutMs = 30_000) {
  const repo = new MemoryRepo();
  const hub = new EventHub();
  const tc = fakeToolchain();
  const project: Project = (await repo.createProject({ id: crypto.randomUUID(), slug: "comfort", name: "Comfort", appName: "ComfortApp", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: "p", traceLevel: "node" }, status: "ready" }))!;
  const gen = async (state: Generation["state"] = "succeeded", createdAt = Date.now()) => {
    const g: Generation = {
      id: `g_${crypto.randomUUID()}`,
      projectId: project.id,
      state,
      stages: STAGES.map((name) => ({ name, state: "passed" })),
      verification: initialVerification(),
      diagnostics: [],
      generatedFiles: [],
      workflows: [],
      runInfo: { traceMap, signals: [{ path: "Vehicle.Body.Lights.Hazard.IsSignaling", vssType: "actuator", dataType: "boolean", access: ["write"] }, { path: "Vehicle.Speed", vssType: "sensor", dataType: "float", access: ["subscribe"] }] },
      request: { graphs: [] },
      createdAt,
    };
    await repo.createGeneration(g);
    return g;
  };
  let n = 0;
  const runs = new RunManager({ repo, clients: tc.clients, hub, databrokers: { "v4.0": "databroker:55555" }, newId: () => `r_${++n}`, startTimeoutMs, batchMs: 1 });
  return { repo, hub, tc, project, gen, runs };
}

const until = async (cond: () => Promise<boolean> | boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(2);
  }
};

describe("RunManager (M08-T03/T04, analysis/08 §5)", () => {
  test("start ⇒ starting; app.started ⇒ running; Stop ⇒ stopping ⇒ stopped; written actuators are mirrored meanwhile", async () => {
    const { repo, tc, project, gen, runs } = await setup();
    const g = await gen();
    const run = await runs.start(project, g.id);
    expect(run).toMatchObject({ id: "r_1", state: "starting", traceLevel: "node", vssRelease: "v4.0", jobId: "job-run" });
    expect(tc.calls).toEqual(["mirror v4.0 [Vehicle.Body.Lights.Hazard.IsSignaling]", 'run {"SDV_VEHICLEDATABROKER_ADDRESS":"grpc://databroker:55555","SV_TRACE_LEVEL":"node","SV_RUN_ID":"r_1"}']);
    tc.say(svtrace({ ev: "app.started" }));
    tc.say(svtrace({ wf: "gw_a", run: 1, node: "n2", ev: "enter" }));
    await until(async () => (await repo.run("r_1"))!.state === "running");
    expect((await repo.run("r_1"))!.runningAt).toBeNumber();
    const stopping = await runs.stop("r_1");
    expect(stopping!.state).toBe("stopping");
    await until(async () => (await repo.run("r_1"))!.state === "stopped");
    expect(tc.calls).toContain("stop job-run");
    expect(tc.calls.at(-1)).toBe("mirror v4.0 []");
    const events = await repo.runEvents("r_1", -1);
    expect(events.find((e) => e.kind === "trace" && (e.body as { blockId?: string }).blockId === "b2")).toBeDefined();
    expect(events.map((e) => e.seq)).toEqual(events.map((_, k) => k));
  });

  test("one run at a time; only the project's latest successful generation runs; the trace level only goes down", async () => {
    const { project, gen, runs, repo } = await setup();
    const old = await gen("succeeded", 1);
    const latest = await gen("succeeded", 2);
    await expect(runs.start(project, old.id)).rejects.toThrow("The project changed since this generation");
    const run = await runs.start(project, latest.id, "trigger");
    expect(run.traceLevel).toBe("trigger");
    const err = await runs.start(project, latest.id).catch((e) => e);
    expect(err).toBeInstanceOf(RunConflict);
    expect((err as RunConflict).activeRun?.id).toBe(run.id);
    await repo.updateRun(run.id, { state: "stopped" });
    await gen("failed", 3);
    await expect(runs.start(project, latest.id)).rejects.toThrow("changed since");
  });

  test("the app exits on its own ⇒ crashed with RUN_CRASHED and its exit code", async () => {
    const { repo, tc, project, gen, runs } = await setup();
    await runs.start(project, (await gen()).id);
    tc.say(svtrace({ ev: "app.started" }));
    tc.say("Segmentation fault");
    tc.exit(139);
    await until(async () => (await repo.run("r_1"))!.state === "crashed");
    const run = (await repo.run("r_1"))!;
    expect(run).toMatchObject({ exitCode: 139, diagnostics: [{ code: "RUN_CRASHED", stage: "run" }] });
    const logs = (await repo.runEvents("r_1", -1)).filter((e) => e.kind === "log").map((e) => (e.body as LogLine).msg);
    expect(logs).toContain("Segmentation fault");
    expect(logs.at(-1)).toContain("The app exited with 139");
  });

  test("no app.started within the start timeout ⇒ the app is stopped and the run crashed with RUN_START_TIMEOUT", async () => {
    const { repo, tc, project, gen, runs } = await setup(30);
    await runs.start(project, (await gen()).id);
    await until(async () => (await repo.run("r_1"))!.state === "crashed");
    expect((await repo.run("r_1"))!.diagnostics).toMatchObject([{ code: "RUN_START_TIMEOUT" }]);
    expect(tc.calls).toContain("stop job-run");
  });

  test("HTTP: POST /projects/{id}/runs, GET /runs?active, GET /runs/{rid}, stop, and /events?runId resumes after Last-Event-ID", async () => {
    const { repo, hub, tc, project, gen, runs } = await setup();
    const g = await gen();
    const h = createOrchestratorHandler({ repo, clients: tc.clients, hub, runs, kick() {}, background() {} });
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => h(new Request(`http://o${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
    expect((await call("POST", `/projects/${project.id}/runs`, { generationId: 7 })).status).toBe(400);
    expect((await call("POST", `/projects/${project.id}/runs`, { generationId: "g_nope" })).status).toBe(404);
    // without generationId: the latest generation
    const started = await call("POST", `/projects/${project.id}/runs`, {});
    expect(started.status).toBe(202);
    const run = await started.json();
    expect(run).toMatchObject({ id: "r_1", projectId: project.id, generationId: g.id, state: "starting" });
    expect(run.jobId).toBeUndefined();
    const busy = await call("POST", `/projects/${project.id}/runs`, { generationId: g.id });
    expect(busy.status).toBe(409);
    expect((await busy.json()).activeRun.id).toBe("r_1");
    tc.say(svtrace({ ev: "app.started" }));
    tc.say("hello");
    await until(async () => (await repo.runEvents("r_1", -1)).length >= 3);
    expect((await (await call("GET", "/runs?active=true")).json()).runs.map((r: { id: string }) => r.id)).toEqual(["r_1"]);
    const streamed = call("GET", "/events?runId=r_1").then((r) => r.text());
    await Bun.sleep(5);
    tc.say(svtrace({ wf: "gw_a", run: 1, node: "n3", ev: "exit" }));
    await Bun.sleep(5);
    expect((await call("POST", "/runs/r_1/stop")).status).toBe(200);
    const text = await streamed;
    const kinds = text.split("\n").filter((l) => l.startsWith("event: ")).map((l) => l.slice(7));
    expect(kinds).toContain("trace");
    expect(kinds).toContain("log");
    expect(text).toContain('"blockId":"b3"');
    const resumed = await (await call("GET", "/events?runId=r_1", undefined, { "last-event-id": "1" })).text();
    expect(resumed.split("\n").find((l) => l.startsWith("id: "))).toBe("id: 2");
    expect((await (await call("GET", "/runs/r_1")).json()).state).toBe("stopped");
    expect((await call("GET", "/runs/r_nope")).status).toBe(404);
  });
});
