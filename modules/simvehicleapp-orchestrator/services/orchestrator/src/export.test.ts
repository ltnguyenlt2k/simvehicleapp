import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { createOrchestratorHandler } from "./app.ts";
import { canonicalJson, EntitlementService, loadLicense } from "./entitlements.ts";
import { EventHub } from "./events.ts";
import { exportExtras } from "./export.ts";
import { type Generation, initialVerification, MemoryRepo, STAGES } from "./repo.ts";

const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
const graph = { graphVersion: "1.0.0", workflowId: "gw_a", name: "Stable Overspeed Warning", vss: { release: "v4.0" }, blocks: [], edges: [] };

async function setup() {
  const repo = new MemoryRepo();
  const project = await repo.createProject({ id: crypto.randomUUID(), slug: "comfort", name: "Comfort", appName: "ComfortApp", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: "p", traceLevel: "node" }, status: "ready" });
  const gen: Generation = { id: "g1", projectId: project.id, state: "succeeded", stages: STAGES.map((name) => ({ name, state: "passed" })), verification: { ir: "passed", format: "passed", compile: "passed", tests: "passed" }, diagnostics: [], generatedFiles: [], workflows: [{ workflowId: "gw_a", revision: 3, irHash: "sha256:abc" }], backend: "cpp@0.1.0", request: { graphs: [graph] }, createdAt: 1 };
  await repo.createGeneration(gen);
  return { repo, project, gen };
}

describe("export (M09-T06, ADR-0031 §1)", () => {
  test("extras: the workflow graphs (re-importable), the generation, the license, README and notices — no clock", async () => {
    const { project, gen } = await setup();
    const files = exportExtras(project, gen, { edition: "full" });
    expect(files.map((f) => f.path)).toEqual([".simvehicleapp/workflows/gw_a.graph.json", ".simvehicleapp/generation.json", ".simvehicleapp/license.json", "README.SIMVEHICLE.md", "NOTICE", "THIRD-PARTY-NOTICES"]);
    expect(JSON.parse(files[0]!.content)).toEqual(graph);
    expect(JSON.parse(files[1]!.content)).toMatchObject({ generationId: "g1", workflows: [{ workflowId: "gw_a", revision: 3 }] });
    expect(files[3]!.content).toContain("docker build -f app/Dockerfile .");
    expect(files[5]!.content).toContain("MPL-2.0");
    expect(exportExtras(project, gen, null)).toEqual(exportExtras(project, gen, null));
    expect(exportExtras(project, null, null).map((f) => f.path)).toEqual(["README.SIMVEHICLE.md", "NOTICE", "THIRD-PARTY-NOTICES"]);
    expect(files[3]!.content).toContain("./build.sh");
  });

  test("a Python project's README and notices are about the Python template and SDK (ADR-0040)", async () => {
    const { project, gen } = await setup();
    const files = exportExtras({ ...project, language: "python" }, gen, null);
    const [readme, notice, third] = files.slice(-3).map((f) => f.content);
    expect(readme).toContain("Velocitas Python vehicle app (eclipse-velocitas/vehicle-app-python-template)");
    expect(readme).toContain("python3 app/src/main.py");
    expect(readme).toContain("app/src/user_hooks.py");
    expect(readme).not.toContain("build.sh");
    expect(notice).toContain("vehicle-app-python-template");
    expect(third).toContain("velocitas-sdk 0.15.7");
    expect(third).not.toContain("Conan");
    const [rsReadme, , rsThird] = exportExtras({ ...project, language: "rust" }, gen, null).slice(-3).map((f) => f.content);
    expect(rsReadme).toContain("experimental, not Velocitas tooling");
    expect(rsReadme).toContain("cargo test --release --test generated");
    expect(rsThird).toContain("kuksa-rust-sdk 0.2.2");
  });

  test("POST /projects/{id}/export streams the workspace zip of the latest successful generation; a license without export.source is 403", async () => {
    const { repo, project } = await setup();
    const sent: unknown[] = [];
    const clients = {
      exportProject: async (slug: string, body: unknown) => {
        sent.push({ slug, body });
        return new Response(new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]), { headers: { "content-type": "application/zip" } });
      },
    } as never;
    const h = createOrchestratorHandler({ repo, clients, hub: new EventHub(), kick() {}, background() {} });
    const res = await h(new Request(`http://o/projects/${project.id}/export`, { method: "POST" }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="comfort.zip"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(sent[0]).toMatchObject({ slug: "comfort", body: { generationId: "g1", extraFiles: expect.arrayContaining([expect.objectContaining({ path: ".simvehicleapp/workflows/gw_a.graph.json" })]) } });

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const doc = { licenseVersion: "1.0.0", edition: "community", licensee: "Jane", features: { "export.source": false }, limits: {}, expiry: null };
    const license = { ...doc, signature: sign(null, Buffer.from(canonicalJson(doc)), privateKey).toString("base64") };
    const entitlements = new EntitlementService("enforce", loadLicense(JSON.stringify(license), publicKey.export({ type: "spki", format: "pem" }).toString()));
    const denied = await createOrchestratorHandler({ repo, clients, hub: new EventHub(), entitlements, kick() {}, background() {} })(new Request(`http://o/projects/${project.id}/export`, { method: "POST" }), ctx);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "not_entitled", feature: "export.source" });
    expect(sent).toHaveLength(1);
  });
});
