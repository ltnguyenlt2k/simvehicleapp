import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractValidator } from "@simvehicleapp/contracts";
import { createAgentHandler } from "./app.ts";
import { createPlanner, PlanError, projectDir, validateJob, vssFile } from "./commands.ts";
import { type JobKind, JobManager, type Plan } from "./jobs.ts";
import { templateTar } from "./templates.ts";

const validator = new ContractValidator();
// A scratch dir inside the module (a confined bun cannot always use /tmp).
const SCRATCH = mkdtempSync(fileURLToPath(new URL("../.test-", import.meta.url)));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const sh = (script: string) => ["bash", "-c", script];
const waitFor = async (cond: () => boolean, ms = 10_000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(10);
  }
};
const fakePlanner =
  (plans: Partial<Record<JobKind, Plan>>) =>
  (kind: JobKind): Plan => {
    const p = plans[kind];
    if (!p) throw new PlanError(`no plan for ${kind}`);
    return p;
  };
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;

describe("job queue (ADR-0025 §4)", () => {
  test("build-class jobs run one at a time in order; lines are LogLine v1 with seq; final state + diagnostics", async () => {
    const order: string[] = [];
    const plan = (name: string, script: string, check?: () => string | null): Plan => ({
      steps: [{ label: name, argv: sh(script), cwd: SCRATCH, after: () => void order.push(name), ...(check ? { check } : {}) }],
      failCode: "BUILD_FAILED",
      failStage: "build",
    });
    let n = 0;
    const jobs = new JobManager(
      fakePlanner({
        deps: plan("deps", "sleep 0.2; echo one; echo 'oops: error here' 1>&2"),
        build: plan("build", "echo built", () => "build/bin/app was not produced"),
        test: plan("test", "exit 3"),
      }),
      () => `job-${n++}`,
    );
    const a = jobs.create("deps", "p");
    const b = jobs.create("build", "p");
    const c = jobs.create("test", "p");
    expect(jobs.get(b.id)!.state).toBe("queued");
    await waitFor(() => ["failed", "succeeded"].includes(jobs.get(c.id)!.state));
    expect(order).toEqual(["deps"]);
    expect(jobs.get(a.id)!.state).toBe("succeeded");
    expect(jobs.get(b.id)).toMatchObject({ state: "failed", exitCode: 0, diagnostics: [{ code: "BUILD_FAILED", message: "build/bin/app was not produced" }] });
    expect(jobs.get(c.id)).toMatchObject({ state: "failed", exitCode: 3 });
    for (const j of [a, b, c]) expect(validator.validate("toolchain-job", jobs.get(j.id)).errors).toEqual([]);
    const lines = jobs.lines(a.id);
    expect(lines.map((l) => l.seq)).toEqual(lines.map((_, i) => i));
    for (const l of lines) expect(validator.validate("log-line", l).errors).toEqual([]);
    expect(lines.find((l) => l.msg === "oops: error here")).toMatchObject({ stream: "stderr", level: "error" });
    expect(lines.at(-1)).toMatchObject({ stream: "system", msg: "job succeeded" });
  });

  test("cancel stops the whole process group; a queued job is cancelled without running", async () => {
    const jobs = new JobManager(
      fakePlanner({
        build: { steps: [{ label: "long", argv: sh("sleep 30 & sleep 30; wait"), cwd: SCRATCH }], failCode: "BUILD_FAILED", failStage: "build" },
        test: { steps: [{ label: "never", argv: sh("echo never"), cwd: SCRATCH }], failCode: "GENERATED_TEST_FAILED", failStage: "test" },
      }),
    );
    const a = jobs.create("build", "p");
    const b = jobs.create("test", "p");
    await waitFor(() => jobs.get(a.id)!.state === "running" && jobs.lines(a.id).length > 0);
    jobs.cancel(b.id);
    jobs.cancel(a.id);
    await waitFor(() => jobs.get(a.id)!.state === "cancelled", 5_000);
    expect(jobs.get(b.id)!.state).toBe("cancelled");
    expect(jobs.lines(b.id).some((l) => l.msg === "never")).toBe(false);
  });

  test("one run at a time; stop sends SIGINT to the run and waits for it", async () => {
    const jobs = new JobManager(
      fakePlanner({ run: { steps: [{ label: "app", argv: sh("trap 'echo bye; exit 0' INT; echo up; while true; do sleep 0.05; done"), cwd: SCRATCH }], failCode: "RUN_CRASHED", failStage: "run" } }),
    );
    const run = jobs.create("run", "p");
    expect(() => jobs.create("run", "p")).toThrow("a run is already active");
    await waitFor(() => jobs.lines(run.id).some((l) => l.msg === "up"));
    const stop = jobs.create("stop", "p", { runJobId: run.id });
    await waitFor(() => jobs.get(stop.id)!.state === "succeeded", 8_000);
    expect(jobs.lines(run.id).some((l) => l.msg === "bye")).toBe(true);
    expect(jobs.get(run.id)!.state).toBe("cancelled");
    expect(() => jobs.create("stop", "p", { runJobId: "nope" })).toThrow();
  });

  test("a long run keeps streaming: the oldest lines drop, seq keeps counting; a build log stays capped", async () => {
    const jobs = new JobManager(
      fakePlanner({
        run: { steps: [{ label: "app", argv: sh("seq 1 60000"), cwd: SCRATCH }], failCode: "RUN_CRASHED", failStage: "run" },
        build: { steps: [{ label: "cc", argv: sh("seq 1 60000"), cwd: SCRATCH }], failCode: "BUILD_FAILED", failStage: "build" },
      }),
    );
    const run = jobs.create("run", "p");
    await waitFor(() => jobs.get(run.id)!.state === "succeeded", 20_000);
    const lines = jobs.lines(run.id);
    expect(lines.length).toBeLessThanOrEqual(50_000);
    expect(lines.at(-1)!.msg).toBe("job succeeded");
    expect(lines.at(-2)!.msg).toBe("60000");
    expect(lines.at(-1)!.seq).toBe(60_001); // seq 0 "$ app", 1…60 000 the output, then "job succeeded"
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.seq).toBe(lines[i - 1]!.seq + 1);
    const seen: number[] = [];
    jobs.subscribe(run.id, 59_990, (l) => seen.push(l.seq), () => {});
    expect(seen).toEqual([59_991, 59_992, 59_993, 59_994, 59_995, 59_996, 59_997, 59_998, 59_999, 60_000, 60_001]);

    const build = jobs.create("build", "p");
    await waitFor(() => jobs.get(build.id)!.state === "succeeded", 20_000);
    expect(jobs.lines(build.id).at(-1)!.msg).toBe("49999");
  });
});

describe("HTTP API (openapi/toolchain.v1.yaml)", () => {
  test("POST /jobs validates the request; 409 on a second run; SSE streams LogLine and resumes after Last-Event-ID", async () => {
    const jobs = new JobManager(
      fakePlanner({
        build: { steps: [{ label: "b", argv: sh("for i in 1 2 3; do echo line$i; done"), cwd: SCRATCH }], failCode: "BUILD_FAILED", failStage: "build" },
        run: { steps: [{ label: "app", argv: sh("sleep 5"), cwd: SCRATCH }], failCode: "RUN_CRASHED", failStage: "run" },
      }),
      undefined,
      undefined,
      (kind) => {
        if (kind === "deps") throw new PlanError("project p does not exist");
      },
    );
    const handler = createAgentHandler({ jobs, template: () => null });
    const post = (body: unknown) => handler(new Request("http://x/jobs", { method: "POST", body: JSON.stringify(body) }), ctx);
    expect((await post({ kind: "nope", project: "p" })).status).toBe(400);
    expect((await post({ kind: "deps", project: "p" })).status).toBe(422); // no plan ⇒ diagnostics
    const created = await post({ kind: "build", project: "p" });
    expect(created.status).toBe(202);
    const job = await created.json();
    const text = await (await handler(new Request(`http://x/jobs/${job.id}/stream`), ctx)).text();
    const events = text.trim().split("\n\n").map((e) => JSON.parse(e.split("\n").find((l) => l.startsWith("data: "))!.slice(6)));
    expect(events.filter((e) => e.stream === "stdout").map((e) => e.msg)).toEqual(["line1", "line2", "line3"]);
    const resumed = await (await handler(new Request(`http://x/jobs/${job.id}/stream`, { headers: { "last-event-id": "2" } }), ctx)).text();
    expect(resumed.split("\n").filter((l) => l.startsWith("id: ")).map((l) => Number(l.slice(4)))).toEqual(events.slice(3).map((e) => e.seq));
    expect((await (await handler(new Request(`http://x/jobs/${job.id}`), ctx)).json()).state).toBe("succeeded");
    const run = await (await post({ kind: "run", project: "p" })).json();
    expect((await post({ kind: "run", project: "p" })).status).toBe(409);
    await handler(new Request(`http://x/jobs/${run.id}/cancel`, { method: "POST" }), ctx);
    expect((await handler(new Request("http://x/templates?lang=rust"), ctx)).status).toBe(400);
    expect((await handler(new Request("http://x/templates?lang=python"), ctx)).status).toBe(404);
  });
});

describe("plans of a real project (ADR-0025 §3, M07-T05)", () => {
  const cfg = { projectsDir: join(SCRATCH, "projects"), modelHashFile: join(SCRATCH, "conan", ".sv-model-hash") };
  const dir = join(cfg.projectsDir, "comfort-app");
  mkdirSync(join(dir, "app/vss"), { recursive: true });
  writeFileSync(join(dir, ".velocitas.json"), JSON.stringify({ variables: { appManifestPath: "app/AppManifest.json" } }));
  writeFileSync(join(dir, "app/AppManifest.json"), JSON.stringify({ interfaces: [{ type: "vehicle-signal-interface", config: { src: "app/vss/vss_rel_4.0.json" } }] }));
  writeFileSync(join(dir, "app/vss/vss_rel_4.0.json"), '{"Vehicle":{}}');

  test("slugs cannot leave the projects directory; unknown projects are rejected", () => {
    expect(() => projectDir(cfg, "../etc")).toThrow(PlanError);
    expect(() => projectDir(cfg, "a/b")).toThrow(PlanError);
    expect(() => createPlanner(cfg)("build", "missing", {})).toThrow(PlanError);
  });

  test("generate-model runs before deps/build only when the project's VSS differs from the cached model", async () => {
    expect(vssFile(dir)).toBe(join(dir, "app/vss/vss_rel_4.0.json"));
    const plan = createPlanner(cfg)("build", "comfort-app", {});
    const model = plan.steps[0]!;
    expect(model.label).toContain("generate-model");
    expect(await model.when!()).toBe(true); // nothing cached yet
    await model.after!();
    expect(await model.when!()).toBe(false); // same VSS ⇒ skipped
    writeFileSync(join(dir, "app/vss/vss_rel_4.0.json"), '{"Vehicle":{"Speed":{}}}');
    expect(await model.when!()).toBe(true); // VSS changed ⇒ regenerate
    expect(plan.steps[1]).toMatchObject({ label: "./build.sh" });
    expect(plan.steps[1]!.check!([])).toBe("build/bin/app was not produced (see the build log)");
    expect(() => validateJob(cfg, "run", "comfort-app", {})).toThrow("build the project first");
    mkdirSync(join(dir, "build/bin"), { recursive: true });
    writeFileSync(join(dir, "build/bin/app"), "stale");
    // a failed build leaves the previous binary: the output decides
    expect(plan.steps[1]!.check!(["[1/2] Building CXX", "FAILED: app/src/CMakeFiles/app.dir/x.cpp.o", "ninja: build stopped: subcommand failed."])).toBe("the build failed: FAILED: app/src/CMakeFiles/app.dir/x.cpp.o");
    expect(plan.steps[1]!.check!(["-- Configuring incomplete, errors occurred!"])).toContain("Configuring incomplete");
    expect(plan.steps[1]!.check!(["[2/2] Linking CXX executable bin/app"])).toBeNull();
    expect(createPlanner(cfg)("build", "comfort-app", { release: true }).steps[1]!.label).toBe("./build.sh -r");
    expect(() => validateJob(cfg, "run", "missing", {})).toThrow("does not exist");
    expect(() => validateJob(cfg, "build", "missing", {})).toThrow("does not exist");
    expect(() => validateJob(cfg, "run", "comfort-app", { env: { PATH: "/x" } })).toThrow("not allowed");
    expect(createPlanner(cfg)("run", "comfort-app", { env: { SDV_MQTT_ADDRESS: "mqtt://mqtt:1883" } }).steps[0]!.env).toEqual({ SDV_MQTT_ADDRESS: "mqtt://mqtt:1883" });
  });

  test("template tar: deterministic, no build outputs", async () => {
    const seed = join(SCRATCH, "seed");
    mkdirSync(join(seed, "app"), { recursive: true });
    mkdirSync(join(seed, "build"), { recursive: true });
    writeFileSync(join(seed, "app/AppManifest.json"), "{}");
    writeFileSync(join(seed, "build/x"), "y");
    const read = async () => new Uint8Array(await new Response(templateTar("cpp", { cpp: seed })!).arrayBuffer());
    const a = await read();
    const b = await read();
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    const names = new TextDecoder().decode(a);
    expect(names).toContain("./app/AppManifest.json");
    expect(names).not.toContain("./build/x");
    expect(templateTar("cpp", { cpp: join(SCRATCH, "nope") })).toBeNull();
  });
});
