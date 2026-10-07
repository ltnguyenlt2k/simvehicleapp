import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fixturesDir } from "@simvehicleapp/contracts";
import { createOrchestratorHandler } from "./app.ts";
import { EventHub } from "./events.ts";
import { MemoryRepo } from "./repo.ts";

/**
 * SynCode without the studio (MCP agents, M10 review): `GET /projects/{id}/graphs` gives the workflows of
 * the last SynCode, `fromGeneration: "latest"` runs SynCode again with them (and their scenarios).
 */
const graph = JSON.parse(readFileSync(`${fixturesDir}/golden/GW-A/graph.json`, "utf8"));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;

async function app() {
  const repo = new MemoryRepo();
  const h = createOrchestratorHandler({ repo, clients: {} as never, hub: new EventHub(), ideUrl: "", kick() {}, background() {} });
  const p = await repo.createProject({ id: crypto.randomUUID(), slug: "hazard", name: "Hazard", appName: "HazardApp", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: "sv", traceLevel: "node" }, status: "ready" });
  const call = (method: string, path: string, body?: unknown) => h(new Request(`http://o${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
  return { repo, p, call };
}

describe("SynCode from the saved workflows", () => {
  test("no SynCode yet ⇒ GET graphs 404, fromGeneration latest 409", async () => {
    const { p, call } = await app();
    expect((await call("GET", `/projects/${p.id}/graphs`)).status).toBe(404);
    const res = await call("POST", `/projects/${p.id}/generations`, { fromGeneration: "latest" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_previous_generation" });
  });

  test("after a SynCode: graphs of the last one; fromGeneration latest queues them again with their scenarios", async () => {
    const { repo, p, call } = await app();
    const scenarios = [{ workflowId: graph.workflowId, scenario: { scenarioVersion: "1.0.0", name: "S", until: 1000, inputs: [] } }];
    const first = await call("POST", `/projects/${p.id}/generations`, { graphs: [graph], scenarios });
    expect(first.status).toBe(202);
    const listed = await (await call("GET", `/projects/${p.id}/graphs`)).json();
    expect(listed).toMatchObject({ generationId: (await first.json()).id, graphs: [{ workflowId: graph.workflowId }] });
    const again = await call("POST", `/projects/${p.id}/generations`, { fromGeneration: "latest" });
    expect(again.status).toBe(202);
    const g = await repo.generation((await again.json()).id);
    expect(g?.request).toMatchObject({ graphs: [{ workflowId: graph.workflowId }], scenarios });
  });
});

describe("editor link per language (ADR-0040: ide-python)", () => {
  test("SV_IDE_URL is one URL for every language, or one per language", async () => {
    const { editorUrl } = await import("./pipeline.ts");
    const cpp = { slug: "a", language: "cpp" } as never;
    const py = { slug: "b", language: "python" } as never;
    expect(editorUrl("http://127.0.0.1:8080/", cpp)).toBe("http://127.0.0.1:8080/?folder=/workspace/projects/a");
    expect(editorUrl("http://127.0.0.1:8080", py)).toBe("http://127.0.0.1:8080/?folder=/workspace/projects/b");
    const both = "cpp=http://127.0.0.1:8080,python=http://127.0.0.1:8081";
    expect(editorUrl(both, cpp)).toBe("http://127.0.0.1:8080/?folder=/workspace/projects/a");
    expect(editorUrl(both, py)).toBe("http://127.0.0.1:8081/?folder=/workspace/projects/b");
    expect(editorUrl("cpp=http://127.0.0.1:8080", py)).toBeNull();
    expect(editorUrl(undefined, cpp)).toBeNull();
  });
});
