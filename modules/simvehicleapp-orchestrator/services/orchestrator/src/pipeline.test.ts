import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ContractValidator, fixturesDir } from "@simvehicleapp/contracts";
import { createOrchestratorHandler } from "./app.ts";
import type { Clients, FileSet, ToolchainJob } from "./clients.ts";
import { ServiceUnavailable } from "./clients.ts";
import { EventHub } from "./events.ts";
import { present, runGeneration } from "./pipeline.ts";
import { type Generation, initialVerification, MemoryRepo, type Project, STAGES } from "./repo.ts";

const validator = new ContractValidator();
const graph = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/graph.json`, "utf8"));
const ir = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/ir.json`, "utf8"));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;

const fileset: FileSet = {
  backend: "cpp@0.1.0",
  runtimeVersion: "0.1.0",
  files: [{ path: "app/src/generated/workflows/StableOverspeedWarning.cpp", content: "x", sha256: "0".repeat(64), role: "source" }],
  ownedRoots: ["app/src/generated/", "app/tests/generated/"],
  manifestFragment: {},
  sourceMaps: [{ file: "app/src/generated/workflows/StableOverspeedWarning.cpp", ranges: [{ startLine: 42, endLine: 49, nodeId: "n2", blockId: "b2", workflowId: "gw_a" }] }],
  diagnostics: [],
};

type JobScript = Partial<Record<string, { state: ToolchainJob["state"]; lines?: string[] }>>;

function fakeClients(overrides: Partial<Clients> = {}, jobs: JobScript = {}) {
  const calls: string[] = [];
  const clients: Clients = {
    compile: async () => (calls.push("compile"), { ir, diagnostics: [{ code: "UNIT_ASSUMED", severity: "info", stage: "units", message: "m", docs: "diagnostics#UNIT_ASSUMED" }] }),
    generate: async (_l, req) => (calls.push(`generate:${JSON.stringify((req as { scenarios?: unknown }).scenarios ?? null).length > 4 ? "with-scenarios" : "no-scenarios"}`), { ok: true, value: fileset }),
    createProject: async () => (calls.push("ws:create"), { ok: true, value: {} }),
    commit: async () => (calls.push("ws:commit"), { ok: true, value: {} }),
    workspaceGet: async (path) =>
      path.endsWith("/tree")
        ? { ok: true, value: { files: [{ path: "app/src/generated/A.cpp", size: 7, owned: true }] } }
        : path.endsWith("/generations")
          ? { ok: true, value: { current: "g1", generations: ["g1"] } }
          : path.includes("missing")
            ? { ok: false, status: 404, diagnostics: [] }
            : { ok: true, value: { path: "app/src/generated/A.cpp", content: path.includes("/generations/") ? "old" : "new" } },
    job: async (_l, kind, _p, onLine) => {
      calls.push(`job:${kind}`);
      const s = jobs[kind] ?? { state: "succeeded" };
      let seq = 0;
      const ran = ["[==========] 1 test from 1 test suite ran. (1 ms total)", "[  PASSED  ] 1 test."];
      for (const msg of s.lines ?? (kind === "test" ? ran : [`${kind} ok`])) onLine({ runId: "j", seq: seq++, ts: 0, stream: "stdout", level: "info", msg });
      return { id: `j-${kind}`, state: s.state, exitCode: s.state === "succeeded" ? 0 : 1, diagnostics: [] };
    },
    startJob: async (_l, kind) => (calls.push(`start:${kind}`), { ok: true, value: { id: `j-${kind}`, state: "running", exitCode: null, diagnostics: [] } }),
    followJob: async (_l, id) => ({ id, state: "succeeded", exitCode: 0, diagnostics: [] }),
    mirror: async (release, paths) => void calls.push(`mirror:${release}:${paths.join(",")}`),
    ...overrides,
  };
  return { clients, calls };
}

async function setup(projectPatch: Partial<Project> = {}) {
  const repo = new MemoryRepo();
  const project = await repo.createProject({
    id: crypto.randomUUID(),
    slug: "comfort",
    name: "Comfort",
    appName: "ComfortApp",
    language: "cpp",
    vssRelease: "v4.0",
    settings: { mqttTopicPrefix: "simvehicleapp/comfort", traceLevel: "node" },
    status: "ready",
  });
  if (Object.keys(projectPatch).length) await repo.updateProject(project.id, projectPatch);
  const gen = (request: Generation["request"] = { graphs: [graph] }): Generation => ({
    id: `g_${crypto.randomUUID()}`,
    projectId: project.id,
    state: "running",
    stages: STAGES.map((name) => ({ name, state: "pending" })),
    verification: initialVerification(),
    diagnostics: [],
    generatedFiles: [],
    workflows: [],
    request,
    createdAt: 0,
  });
  return { repo, project: (await repo.project(project.id))!, gen };
}

const events = { line() {}, end() {} };

describe("SynCode pipeline (M07-T14, Appendix A/B)", () => {
  test("pass: every stage runs in order, verification {ir, format, compile, tests} all passed; the next run skips deps", async () => {
    const { repo, project, gen } = await setup();
    const { clients, calls } = fakeClients();
    const g1 = gen({ graphs: [graph], scenarios: [{ workflowId: "gw_a", scenario: { scenarioVersion: "1.0.0", name: "s", until: 10, inputs: [] } }] });
    await repo.createGeneration(g1);
    const done = await runGeneration(g1, { repo, clients, events });
    expect(calls).toEqual(["compile", "generate:with-scenarios", "ws:commit", "job:deps", "job:build", "job:format-check", "job:test"]);
    expect(done.state).toBe("succeeded");
    expect(done.verification).toEqual({ ir: "passed", format: "passed", compile: "passed", tests: "passed" });
    expect(done.stages.map((s) => s.state)).toEqual(["passed", "passed", "passed", "passed", "passed", "passed", "passed"]);
    expect(done.workflows).toEqual([{ workflowId: "gw_a", revision: 1, irHash: ir.irHash }]);
    const view = present(done, project, "http://127.0.0.1:8443");
    expect(view).toMatchObject({ success: true, generationId: done.id, workflowRevision: 1, modelHash: ir.modelHash, compilerVersion: ir.compilerVersion, generatedFiles: ["app/src/generated/workflows/StableOverspeedWarning.cpp"], editor: { url: "http://127.0.0.1:8443/?folder=/workspace/projects/comfort" } });
    expect((await repo.project(project.id))!.depsInstalled).toBe(true);
    const g2 = gen();
    await repo.createGeneration(g2);
    const second = fakeClients();
    const d2 = await runGeneration(g2, { repo, clients: second.clients, events });
    expect(second.calls).not.toContain("job:deps");
    expect(d2.stages.find((s) => s.name === "deps")!.state).toBe("skipped");
    const lines = await repo.events(g2.id, -1);
    expect(lines.map((l) => l.seq)).toEqual(lines.map((_, i) => i));
    for (const l of lines) expect(validator.validate("log-line", l).errors).toEqual([]);
  });

  test("a compile error fails at `ir` (Appendix B: success false, stage, diagnostics); later stages are skipped", async () => {
    const { repo, project, gen } = await setup();
    const err = { code: "VEHICLE_WRITE_READ_ONLY", severity: "error", stage: "vehicle-model", message: "Vehicle.Speed is a sensor", docs: "diagnostics#VEHICLE_WRITE_READ_ONLY", blockId: "b3" };
    const { clients, calls } = fakeClients({ compile: async () => ({ diagnostics: [err] }) });
    const g = gen();
    await repo.createGeneration(g);
    const done = await runGeneration(g, { repo, clients, events });
    expect(calls).toEqual([]);
    expect(present(done, project)).toMatchObject({ success: false, state: "failed", stage: "ir", verification: { ir: "failed", format: "skipped", compile: "skipped", tests: "skipped" }, diagnostics: [{ ...err, workflowId: "gw_a" }] });
    expect(done.stages.map((s) => s.state)).toEqual(["failed", "skipped", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  });

  test("a workflow for another VSS release ⇒ PROJECT_VSS_RELEASE_MISMATCH before compiling", async () => {
    const { repo, gen } = await setup();
    const { clients, calls } = fakeClients();
    const g = gen({ graphs: [{ ...graph, vss: { release: "v4.2" } }] });
    await repo.createGeneration(g);
    const done = await runGeneration(g, { repo, clients, events });
    expect(calls).toEqual([]);
    expect(done.diagnostics).toMatchObject([{ code: "PROJECT_VSS_RELEASE_MISMATCH", workflowId: "gw_a", data: { workflow: "v4.2", project: "v4.0" } }]);
    for (const d of done.diagnostics) expect(validator.validate("diagnostics", d).errors).toEqual([]);
  });

  test("hand-edited generated files ⇒ `write` fails with GENERATED_FILE_MODIFIED (resend with overwriteModified)", async () => {
    const { repo, gen } = await setup();
    const modified = { code: "GENERATED_FILE_MODIFIED", severity: "warning", stage: "workspace", message: "A.cpp was changed", docs: "diagnostics#GENERATED_FILE_MODIFIED" };
    let overwrite: boolean | undefined;
    const { clients } = fakeClients({ commit: async (_s, body) => ((overwrite = body.overwriteModified), body.overwriteModified ? { ok: true, value: {} } : { ok: false, status: 409, diagnostics: [modified] }) });
    const g = gen();
    await repo.createGeneration(g);
    expect((await runGeneration(g, { repo, clients, events })).diagnostics).toEqual([modified]);
    const g2 = gen({ graphs: [graph], overwriteModified: true });
    await repo.createGeneration(g2);
    expect((await runGeneration(g2, { repo, clients, events })).state).toBe("succeeded");
    expect(overwrite).toBe(true);
  });

  test("a C++ error in generated code maps to its block; a failing generated test names its workflow", async () => {
    const { repo, gen } = await setup({ depsInstalled: true });
    const gcc = "/workspace/projects/comfort/app/src/generated/workflows/StableOverspeedWarning.cpp:43:7: error: ‘class simvehicleapp::rt::Workflow’ has no member named ‘stableForX’";
    const build = fakeClients({}, { build: { state: "failed", lines: ["[1/3] Building CXX", gcc] } });
    const g = gen();
    await repo.createGeneration(g);
    const done = await runGeneration(g, { repo, clients: build.clients, events });
    expect(done).toMatchObject({ state: "failed", stage: "build", verification: { ir: "passed", compile: "failed", format: "skipped", tests: "skipped" } });
    expect(done.diagnostics).toMatchObject([{ code: "CPP_COMPILE_ERROR", blockId: "b2", nodeId: "n2", workflowId: "gw_a" }]);
    const failing = fakeClients({}, { test: { state: "failed", lines: ["[ RUN      ] StableOverspeedWarningTest.scenarioMeetsItsExpectations", "writes differ", "[  FAILED  ] StableOverspeedWarningTest.scenarioMeetsItsExpectations (1 ms)"] } });
    const g2 = gen();
    await repo.createGeneration(g2);
    const d2 = await runGeneration(g2, { repo, clients: failing.clients, events });
    expect(d2).toMatchObject({ stage: "test", verification: { compile: "passed", format: "passed", tests: "failed" } });
    expect(d2.diagnostics).toMatchObject([{ code: "GENERATED_TEST_FAILED", workflowId: "gw_a" }]);

    // No scenario ⇒ no generated test binary: SynCode passes but tests are "skipped", not "passed".
    const none = fakeClients({}, { test: { state: "succeeded", lines: ["$ build/bin/app_generated_tests", "no app_generated_tests", "no app_utests"] } });
    const g3 = gen();
    await repo.createGeneration(g3);
    const d3 = await runGeneration(g3, { repo, clients: none.clients, events });
    expect(d3).toMatchObject({ state: "succeeded", verification: { ir: "passed", compile: "passed", format: "passed", tests: "skipped" } });
    expect(d3.stages.find((x) => x.name === "test")?.state).toBe("skipped");
  });

  test("an unreachable service is BACKEND_UNAVAILABLE; a project that is not ready fails at once", async () => {
    const { repo, gen } = await setup();
    const { clients } = fakeClients({ compile: async () => { throw new ServiceUnavailable("http://compiler:4020/compile: connection refused"); } });
    const g = gen();
    await repo.createGeneration(g);
    expect((await runGeneration(g, { repo, clients, events })).diagnostics).toMatchObject([{ code: "BACKEND_UNAVAILABLE" }]);
    const creating = await setup({ status: "creating" });
    const g2 = creating.gen();
    await creating.repo.createGeneration(g2);
    const d2 = await runGeneration(g2, { repo: creating.repo, clients: fakeClients().clients, events });
    expect(d2.state).toBe("failed");
    expect(String((d2.diagnostics[0] as { message: string }).message)).toContain("not ready");
  });
});

describe("HTTP API + events (openapi/orchestrator.v1.yaml)", () => {
  test("create project ⇒ ready after workspace + init; assign workflows; queue a generation; stream its log to the end", async () => {
    const repo = new MemoryRepo();
    const hub = new EventHub();
    const { clients, calls } = fakeClients();
    const tasks: Promise<void>[] = [];
    let kicked = 0;
    const h = createOrchestratorHandler({ repo, clients, hub, kick: () => kicked++, background: (p) => void tasks.push(p) });
    const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => h(new Request(`http://o${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
    expect((await call("POST", "/projects", { slug: "x", name: "", language: "cpp", vssRelease: "v4.0" })).status).toBe(400);
    const created = await call("POST", "/projects", { slug: "comfort", name: "Comfort app", language: "cpp", vssRelease: "v4.0" });
    expect(created.status).toBe(201);
    const p = await created.json();
    expect(p).toMatchObject({ slug: "comfort", appName: "ComfortApp", status: "creating", settings: { mqttTopicPrefix: "simvehicleapp/comfort", traceLevel: "node" } });
    await Promise.all(tasks);
    expect(calls).toEqual(["ws:create", "job:init"]);
    expect((await (await call("GET", `/projects/${p.id}`)).json()).status).toBe("ready");
    expect((await call("POST", "/projects", { slug: "comfort", name: "Again", language: "cpp", vssRelease: "v4.0" })).status).toBe(409);
    const wf = await (await call("PUT", `/projects/${p.id}/workflows`, { workflows: [{ simWorkflowId: "gw_a" }] })).json();
    expect(wf.workflows).toEqual([{ simWorkflowId: "gw_a", enabled: true }]);
    expect((await call("POST", `/projects/${p.id}/generations`, { graphs: [{ nope: 1 }] })).status).toBe(422);
    const queued = await call("POST", `/projects/${p.id}/generations`, { graphs: [graph] });
    expect(queued.status).toBe(202);
    const g = await queued.json();
    expect(g).toMatchObject({ state: "queued", verification: { ir: "pending", format: "pending", compile: "pending", tests: "pending" } });
    expect(kicked).toBe(1);
    // the worker runs it while a client follows the stream
    const claimed = (await repo.claimGeneration())!;
    const streamed = call("GET", `/events?generationId=${g.id}`).then((r) => r.text());
    await runGeneration(claimed, { repo, clients, events: hub });
    const text = await streamed;
    const msgs = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)).msg);
    expect(msgs[0]).toBe("▶ ir");
    expect(msgs.at(-1)).toBe("SynCode passed");
    const resumed = await (await call("GET", `/events?generationId=${g.id}`, undefined, { "last-event-id": "3" })).text();
    expect(resumed.split("\n").find((l) => l.startsWith("id: "))).toBe("id: 4");
    const view = await (await call("GET", `/projects/${p.id}/generations/${g.id}`)).json();
    expect(view).toMatchObject({ success: true, state: "succeeded" });
    expect((await call("GET", "/events")).status).toBe(400);
    expect(await (await call("GET", `/projects/${p.id}/files`)).json()).toEqual({ files: [{ path: "app/src/generated/A.cpp", size: 7, owned: true }], current: "g1", generations: ["g1"] });
    expect(await (await call("GET", `/projects/${p.id}/file?path=app/src/generated/A.cpp`)).json()).toEqual({ path: "app/src/generated/A.cpp", content: "new" });
    expect(await (await call("GET", `/projects/${p.id}/file?path=app/src/generated/A.cpp&generationId=g1`)).json()).toMatchObject({ content: "old" });
    expect((await call("GET", `/projects/${p.id}/file?path=missing`)).status).toBe(404);
  });
});
