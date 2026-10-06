import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { fixturesDir, loadSchema, SCHEMA_NAMES } from "@simvehicleapp/contracts";
import { createOrchestratorHandler } from "./app.ts";
import { EventHub } from "./events.ts";
import { present } from "./pipeline.ts";
import { initialVerification, MemoryRepo, STAGES } from "./repo.ts";

/** Responses of the orchestrator match `openapi/orchestrator.v1.yaml` (Project, Generation — Appendix A/B). */
const openapi = Bun.YAML.parse(readFileSync(fileURLToPath(import.meta.resolve("@simvehicleapp/contracts/openapi/orchestrator.v1.yaml")), "utf8")) as { components: { schemas: Record<string, unknown> } };
const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
for (const name of SCHEMA_NAMES) ajv.addSchema(loadSchema(name));
ajv.addSchema({ $id: "urn:test:orchestrator-openapi", components: openapi.components });
const schema = (name: string) => ajv.getSchema(`urn:test:orchestrator-openapi#/components/schemas/${name}`)!;
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
const ir = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/ir.json`, "utf8"));

describe("orchestrator responses ⇄ openapi/orchestrator.v1.yaml", () => {
  test("Project and Generation (queued, succeeded, failed) validate", async () => {
    const repo = new MemoryRepo();
    const clients = { createProject: async () => ({ ok: true, value: {} }), job: async () => ({ id: "j", state: "succeeded", exitCode: 0, diagnostics: [] }) } as never;
    const h = createOrchestratorHandler({ repo, clients, hub: new EventHub(), kick() {}, background() {} });
    const p = await (await h(new Request("http://o/projects", { method: "POST", body: JSON.stringify({ slug: "comfort", name: "Comfort", language: "cpp", vssRelease: "v4.0" }) }), ctx)).json();
    expect(schema("Project")(p)).toBe(true);
    const project = (await repo.project(p.id))!;
    const base = { id: "g1", projectId: p.id, stages: STAGES.map((name) => ({ name, state: "pending" as const })), diagnostics: [], generatedFiles: [], workflows: [], request: { graphs: [] }, createdAt: 1 };
    const queued = present({ ...base, state: "queued", verification: initialVerification() }, project);
    const passed = present({ ...base, state: "succeeded", stages: STAGES.map((name) => ({ name, state: "passed" as const, startedAt: 1, finishedAt: 2 })), verification: { ir: "passed", format: "passed", compile: "passed", tests: "passed" }, generatedFiles: ["app/src/generated/A.cpp"], workflows: [{ workflowId: "gw_a", revision: 1, irHash: ir.irHash }], modelHash: ir.modelHash, compilerVersion: ir.compilerVersion, backend: "cpp@0.1.0", finishedAt: 3 }, project, "http://127.0.0.1:8080");
    const failed = present({ ...base, state: "failed", stage: "build", verification: { ir: "passed", format: "skipped", compile: "failed", tests: "skipped" }, diagnostics: [{ code: "CPP_COMPILE_ERROR", severity: "error", stage: "build", message: "m", docs: "diagnostics#CPP_COMPILE_ERROR", blockId: "b2" }], finishedAt: 3 }, project);
    for (const g of [queued, passed, failed]) {
      const ok = schema("Generation")(g);
      if (!ok) console.log(schema("Generation").errors);
      expect(ok).toBe(true);
    }
    expect(passed).toMatchObject({ success: true, editor: { url: "http://127.0.0.1:8080/?folder=/workspace/projects/comfort" } });
    expect(failed).toMatchObject({ success: false, stage: "build" });
  });
});
