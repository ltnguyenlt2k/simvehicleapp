import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DuplicateSlug, initialVerification, PgRepo, STAGES } from "./repo.ts";

/**
 * PgRepo against a real Postgres (CI service container; locally `SV_TEST_DATABASE_URL=…`): migrations
 * are idempotent, the queue hands each generation to one worker, JSON round-trips, restarts requeue.
 */
const url = process.env.SV_TEST_DATABASE_URL;

describe.skipIf(!url)("PgRepo (schema sv on Postgres)", () => {
  test("migrate twice; project + workflows; generations queue FIFO with SKIP LOCKED; events resume", async () => {
    const admin = new SQL(url!);
    await admin`DROP SCHEMA IF EXISTS sv CASCADE`;
    const repo = PgRepo.connect(url!);
    await repo.migrate();
    await repo.migrate();
    const p = await repo.createProject({ id: crypto.randomUUID(), slug: "comfort", name: "Comfort", appName: "ComfortApp", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: "x", traceLevel: "node" }, status: "creating" });
    expect(p).toMatchObject({ slug: "comfort", status: "creating", depsInstalled: false, workflows: [] });
    await expect(repo.createProject({ ...p, id: crypto.randomUUID() })).rejects.toBeInstanceOf(DuplicateSlug);
    await repo.updateProject(p.id, { status: "ready", depsInstalled: true });
    await repo.setWorkflows(p.id, [{ simWorkflowId: "b", enabled: false }, { simWorkflowId: "a", enabled: true }]);
    expect(await repo.project("comfort")).toMatchObject({ status: "ready", depsInstalled: true, settings: { traceLevel: "node" }, workflows: [{ simWorkflowId: "a", enabled: true }, { simWorkflowId: "b", enabled: false }] });
    const mk = (n: number) => ({ id: `g${n}`, projectId: p.id, state: "queued" as const, stages: STAGES.map((name) => ({ name, state: "pending" as const })), verification: initialVerification(), diagnostics: [], generatedFiles: [], workflows: [], request: { graphs: [{ n }] }, createdAt: 1_000 + n });
    for (const n of [1, 2]) await repo.createGeneration(mk(n));
    const [a, b, c] = await Promise.all([repo.claimGeneration(), repo.claimGeneration(), repo.claimGeneration()]);
    expect([a?.id, b?.id, c?.id].filter(Boolean).sort()).toEqual(["g1", "g2"]); // each claimed once
    await repo.updateGeneration("g1", { state: "failed", stage: "build", diagnostics: [{ code: "BUILD_FAILED" }], verification: { ir: "passed", format: "skipped", compile: "failed", tests: "skipped" }, finishedAt: 5_000, workflows: [{ workflowId: "w", revision: 2, irHash: "sha256:x" }] });
    expect(await repo.generation("g1")).toMatchObject({ state: "failed", stage: "build", diagnostics: [{ code: "BUILD_FAILED" }], workflows: [{ revision: 2 }], request: { graphs: [{ n: 1 }] }, finishedAt: 5_000 });
    expect(await repo.requeueRunning()).toBe(1);
    expect((await repo.generation("g2"))!.state).toBe("queued");
    for (let seq = 0; seq < 5; seq++) await repo.appendEvent("g2", { runId: "g2", seq, ts: seq, stream: "system", level: "info", msg: `m${seq}` });
    expect((await repo.events("g2", 2)).map((l) => l.msg)).toEqual(["m3", "m4"]);
    await admin.close();
  });
});
