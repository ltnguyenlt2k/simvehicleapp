import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractValidator } from "@simvehicleapp/contracts";
import { createWorkspaceHandler } from "./app.ts";
import { InitFailed, initProject, type InitSources, ProjectExists, syncProjectVss, velocitasUnits } from "./init.ts";
import { Store } from "./store.ts";

const validator = new ContractValidator();
const SCRATCH = mkdtempSync(fileURLToPath(new URL("../.test-", import.meta.url)));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;

/** A seeded template like the toolchain's (`$SV_SEED_DIR`). */
const seed = join(SCRATCH, "seed");
mkdirSync(join(seed, "app/src"), { recursive: true });
mkdirSync(join(seed, "app/vss"), { recursive: true });
writeFileSync(join(seed, ".velocitas.json"), JSON.stringify({ variables: { appManifestPath: "app/AppManifest.json" } }));
writeFileSync(
  join(seed, "app/AppManifest.json"),
  `${JSON.stringify({ manifestVersion: "v3", name: "SampleApp", interfaces: [{ type: "vehicle-signal-interface", config: { src: "app/vss/vss_rel_4.0.json", datapoints: { required: [{ path: "Vehicle.Speed", required: "true", access: "read" }] } } }, { type: "pubsub", config: { reads: ["sampleapp/getSpeed"], writes: [] } }] }, null, 4)}\n`,
);
writeFileSync(join(seed, "app/vss/vss_rel_4.0.json"), '{"Vehicle":{"release":"4.0"}}');
writeFileSync(join(seed, "app/src/SampleApp.cpp"), "// sample\n");
writeFileSync(join(seed, "build.sh"), "#!/bin/bash\necho build\n", { mode: 0o755 });

const sources = (overrides: Partial<InitSources> = {}): InitSources => ({
  languages: () => ["cpp", "python"],
  template: async () => Bun.spawn(["tar", "-cf", "-", "-C", seed, "."], { stdout: "pipe" }).stdout,
  overlay: async () => ({ runtimeVersion: "0.1.0", files: [{ path: "app/src/CMakeLists.txt", content: "# overlay\n" }, { path: "app/src/user/UserHooks.cpp", content: "// hooks\n" }], remove: ["app/src/SampleApp.cpp"] }),
  runtime: async () => ({ runtimeVersion: "0.1.0", files: [{ path: "app/src/simvehicleapp-runtime/VERSION", content: "0.1.0\n" }] }),
  vss: async (release) => `{"Vehicle":{"release":"${release}"}}`,
  ...overrides,
});

describe("project creation (ADR-0026 §2, M07-T07)", () => {
  test("a WebAssembly project (ADR-0061) takes template, overlay and runtime from the <language>-wasm sources", async () => {
    const asked: string[] = [];
    const src = sources({
      languages: () => ["cpp", "cpp-wasm"],
      template: async (l) => (asked.push(`template ${l}`), Bun.spawn(["tar", "-cf", "-", "-C", seed, "."], { stdout: "pipe" }).stdout),
      overlay: async (l) => (asked.push(`overlay ${l}`), { runtimeVersion: "0.1.0", files: [] }),
      runtime: async (l) => (asked.push(`runtime ${l}`), { runtimeVersion: "0.1.0", files: [] }),
    });
    const store = new Store(join(SCRATCH, "ws-wasm"));
    await initProject(store, { slug: "wasm-app", language: "cpp", target: "wasm", appName: "WasmApp", vssRelease: "v4.0" }, src);
    expect(asked).toEqual(["template cpp-wasm", "overlay cpp-wasm", "runtime cpp-wasm"]);
    expect(JSON.parse(readFileSync(join(store.projectDir("wasm-app"), ".simvehicleapp/project.json"), "utf8"))).toMatchObject({ language: "cpp", target: "wasm" });
    await expect(initProject(store, { slug: "wasm-rs", language: "rust", target: "wasm", appName: "WasmRs", vssRelease: "v4.0" }, src)).rejects.toThrow("no rust-wasm backend");
  });

  test("a template stream that goes on past the end-of-archive marker (record padding) neither fails nor breaks the service", async () => {
    // Guard for the template extraction: the service crashed on an uncaught EPIPE while creating a project (nightly 40186816665).
    const archive = new Uint8Array(await new Response(Bun.spawn(["tar", "-cf", "-", "-C", seed, "."], { stdout: "pipe" }).stdout).arrayBuffer());
    const tail = new Uint8Array(4 * 1024 * 1024);
    const padded = () =>
      new ReadableStream<Uint8Array>({
        async start(c) {
          c.enqueue(archive);
          for (let i = 0; i < 64; i++) {
            await Bun.sleep(1);
            c.enqueue(tail.subarray(i * 65536, (i + 1) * 65536));
          }
          c.close();
        },
      });
    // Served over HTTP like the toolchain's /templates: the agent's body reaches tar's stdin.
    const server = Bun.serve({ port: 0, fetch: () => new Response(padded()) });
    const store = new Store(join(SCRATCH, "ws-padded"));
    try {
      await initProject(store, { slug: "padded-app", language: "cpp", appName: "PaddedApp", vssRelease: "v4.0" }, sources({ template: async () => (await fetch(`http://127.0.0.1:${server.port}/`)).body! }));
    } finally {
      server.stop(true);
    }
    expect(existsSync(join(store.projectDir("padded-app"), "build.sh"))).toBe(true);
    expect(readdirSync(join(store.metaDir, "staging")).filter((f) => f.endsWith(".tar"))).toEqual([]);
  });

  test("template + overlay − sample + runtime + VSS of the release, renamed into place; the sample entries are gone", async () => {
    const store = new Store(join(SCRATCH, "ws1"));
    const meta = await initProject(store, { slug: "comfort-app", language: "cpp", appName: "ComfortApp", vssRelease: "v4.2" }, sources());
    expect(meta).toEqual({ slug: "comfort-app", appName: "ComfortApp", language: "cpp", vssRelease: "v4.2", runtimeVersion: "0.1.0" });
    const dir = store.projectDir("comfort-app");
    expect(existsSync(join(dir, "app/src/SampleApp.cpp"))).toBe(false);
    expect(readFileSync(join(dir, "app/src/CMakeLists.txt"), "utf8")).toBe("# overlay\n");
    expect(readFileSync(join(dir, "app/src/simvehicleapp-runtime/VERSION"), "utf8")).toBe("0.1.0\n");
    expect(statSync(join(dir, "build.sh")).mode & 0o111).not.toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "app/AppManifest.json"), "utf8"));
    expect(manifest.name).toBe("ComfortApp");
    expect(manifest.interfaces[0].config).toEqual({ src: "app/vss/vss_rel_4.2.json", datapoints: { required: [] } });
    expect(manifest.interfaces[1].config).toEqual({ reads: [], writes: [] });
    expect(readFileSync(join(dir, "app/vss/vss_rel_4.2.json"), "utf8")).toBe('{"Vehicle":{"release":"v4.2"}}');
    expect(existsSync(join(dir, "app/vss/vss_rel_4.0.json"))).toBe(false);
    expect(readdirSync(join(store.metaDir, "staging"))).toEqual([]);
    await expect(initProject(store, { slug: "comfort-app", language: "cpp", appName: "X", vssRelease: "v4.0" }, sources())).rejects.toBeInstanceOf(ProjectExists);
  });

  test("a release that ships units gets them in the project, named by the AppManifest unit_src (VSS 4.2: iso8601)", async () => {
    const store = new Store(join(SCRATCH, "ws-units"));
    const asked: string[] = [];
    const src = sources({ units: async (r) => (asked.push(r), r === "v4.2" ? "iso8601:\n  definition: date and time\n  unit: ISO 8601\n  quantity: datetime\n" : null) });
    await initProject(store, { slug: "u42", language: "cpp", appName: "U42", vssRelease: "v4.2" }, src);
    const dir = store.projectDir("u42");
    expect(Bun.YAML.parse(readFileSync(join(dir, "app/vss/units.yaml"), "utf8"))).toEqual({ units: { iso8601: { label: "ISO 8601", description: "date and time", domain: "datetime" } } });
    expect(JSON.parse(readFileSync(join(dir, "app/AppManifest.json"), "utf8")).interfaces[0].config).toEqual({ src: "app/vss/vss_rel_4.2.json", unit_src: ["app/vss/units.yaml"], datapoints: { required: [] } });
    // no units for the release: Velocitas' default stays; the seed's own release is not touched at all
    await initProject(store, { slug: "acme", language: "cpp", appName: "Acme", vssRelease: "v4.0-acme" }, src);
    expect(existsSync(join(store.projectDir("acme"), "app/vss/units.yaml"))).toBe(false);
    await initProject(store, { slug: "seed", language: "cpp", appName: "Seed", vssRelease: "v4.0" }, src);
    expect(asked).toEqual(["v4.2", "v4.0-acme"]);
  });

  test("the seed's own VSS release is kept as is; a failing source leaves no project and no staging", async () => {
    const store = new Store(join(SCRATCH, "ws2"));
    await initProject(store, { slug: "a", language: "cpp", appName: "A", vssRelease: "v4.0" }, sources({ vss: async () => { throw new Error("catalog must not be called"); } }));
    expect(readFileSync(join(store.projectDir("a"), "app/vss/vss_rel_4.0.json"), "utf8")).toBe('{"Vehicle":{"release":"4.0"}}');
    const broken = sources({ overlay: async () => { throw new Error("backend down"); } });
    await expect(initProject(store, { slug: "b", language: "cpp", appName: "B", vssRelease: "v4.0" }, broken)).rejects.toThrow("backend down");
    expect(existsSync(store.projectDir("b"))).toBe(false);
    expect(readdirSync(join(store.metaDir, "staging"))).toEqual([]);
    const escape = sources({ runtime: async () => ({ runtimeVersion: "0.1.0", files: [{ path: "app/src/main.cpp", content: "x" }] }) });
    await expect(initProject(store, { slug: "c", language: "cpp", appName: "C", vssRelease: "v4.0" }, escape)).rejects.toThrow("outside the runtime");
    await expect(initProject(store, { slug: "d", language: "rust", appName: "D", vssRelease: "v4.0" }, sources())).rejects.toBeInstanceOf(InitFailed);
    // a language is installed when it has a backend and a toolchain (SV_BACKENDS ∩ SV_TOOLCHAINS), whatever it is
    const py = await initProject(store, { slug: "py", language: "python", appName: "Py", vssRelease: "v4.0" }, sources());
    expect(py.language).toBe("python");
  });
});

describe("units for Velocitas' generator", () => {
  test("VSS 4.2 format is converted to the vss-tools 4.0 format; the old format is kept", () => {
    const v42 = "# c\nmm:\n  definition: Length measured in millimeters\n  unit: millimeter\n  quantity: length\n  allowed-datatypes: ['numeric']\niso8601:\n  definition: Date and Time\n  unit: ISO 8601\n  quantity: datetime\n";
    expect(Bun.YAML.parse(velocitasUnits(v42))).toEqual({
      units: { mm: { label: "millimeter", description: "Length measured in millimeters", domain: "length" }, iso8601: { label: "ISO 8601", description: "Date and Time", domain: "datetime" } },
    });
    expect(velocitasUnits(v42)).toBe(velocitasUnits(v42));
    const old = "units:\n  mm:\n    label: millimeter\n";
    expect(velocitasUnits(old)).toBe(old);
  });
});

describe("VSS sync before a build (ADR-0052)", () => {
  test("a custom model that gained signals is written into the project; the same document is never rewritten", async () => {
    const store = new Store(join(SCRATCH, "ws-sync"));
    let doc = '{"Vehicle":{"children":{"Speed":{"type":"sensor"}}}}';
    const src = sources({ vss: async () => doc });
    await initProject(store, { slug: "acme", language: "cpp", appName: "Acme", vssRelease: "v4.0-acme" }, src);
    const file = join(store.projectDir("acme"), "app/vss/vss_rel_4.0-acme.json");
    expect(readFileSync(file, "utf8")).toBe(doc);
    // same document, other formatting (the seed keeps COVESA's bytes): no write
    writeFileSync(file, '{\n  "Vehicle": {"children": {"Speed": {"type": "sensor"}}}\n}');
    const before = statSync(file).mtimeMs;
    expect(await syncProjectVss(store, "acme", src)).toEqual({ release: "v4.0-acme", path: "app/vss/vss_rel_4.0-acme.json", changed: false });
    expect(statSync(file).mtimeMs).toBe(before);
    // the custom model gained a signal: the project follows, atomically (no temp file left)
    doc = '{"Vehicle":{"children":{"Speed":{"type":"sensor"},"Acme":{"type":"branch"}}}}';
    expect((await syncProjectVss(store, "acme", src)).changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(doc);
    expect(readdirSync(join(store.projectDir("acme"), "app/vss"))).toEqual(["vss_rel_4.0-acme.json"]);
    // HTTP: 200 with the result, 502 when the catalog fails, 404 for an unknown project
    const ok = createWorkspaceHandler(store, src);
    const post = (h: typeof ok, slug: string) => h(new Request(`http://ws/projects/${slug}/vss-sync`, { method: "POST" }), ctx);
    const r = await post(ok, "acme");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ release: "v4.0-acme", path: "app/vss/vss_rel_4.0-acme.json", changed: false });
    const down = createWorkspaceHandler(store, sources({ vss: async () => { throw new Error("catalog down"); } }));
    const bad = await post(down, "acme");
    expect(bad.status).toBe(502);
    expect((await bad.json())[0].code).toBe("WORKSPACE_COMMIT_FAILED");
    expect((await post(ok, "nope")).status).toBe(404);
  });
});

describe("HTTP API (openapi/workspace.v1.yaml)", () => {
  test("create ⇒ commit ⇒ tree/file/generations ⇒ rollback; errors carry diagnostics", async () => {
    const store = new Store(join(SCRATCH, "ws3"));
    const h = createWorkspaceHandler(store, sources());
    const call = (method: string, path: string, body?: unknown) => h(new Request(`http://ws${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
    expect((await call("POST", "/projects", { slug: "Bad Slug", language: "cpp", appName: "X", vssRelease: "v4.0" })).status).toBe(400);
    expect((await call("POST", "/projects", { slug: "comfort", language: "cpp", appName: "ComfortApp", vssRelease: "v4.0" })).status).toBe(201);
    expect((await call("POST", "/projects", { slug: "comfort", language: "cpp", appName: "ComfortApp", vssRelease: "v4.0" })).status).toBe(409);
    const content = "int a;\n";
    const sha = (c: string) => createHash("sha256").update(c).digest("hex");
    const gen = JSON.stringify({ manifestVersion: "1.0.0", backend: "cpp@0.1.0", runtimeVersion: "0.1.0", contracts: "1.0.0-alpha.1", workflows: [{ workflowId: "gw_a", revision: 1, irHash: `sha256:${"a".repeat(64)}` }], ownedRoots: ["app/src/generated/", "app/tests/generated/"], files: [{ path: "app/src/generated/A.cpp", sha256: sha(content) }] });
    const fileset = {
      backend: "cpp@0.1.0",
      runtimeVersion: "0.1.0",
      files: [
        { path: "app/src/generated/A.cpp", content, sha256: sha(content), role: "source" },
        { path: "app/src/generated/simvehicleapp.gen.json", content: gen, sha256: sha(gen), role: "config" },
      ],
      ownedRoots: ["app/src/generated/", "app/tests/generated/"],
      manifestFragment: { "vehicle-signal-interface": { required: [{ path: "Vehicle.Speed", access: "read" }], provided: [] }, pubsub: { reads: [], writes: [] } },
      sourceMaps: [],
      diagnostics: [],
    };
    expect(validator.validate("generated-fileset", fileset).errors).toEqual([]);
    const committed = await call("POST", "/projects/comfort/commits", { generationId: "g1", fileset });
    expect(committed.status).toBe(200);
    expect(validator.validate("generation-manifest", await committed.json()).errors).toEqual([]);
    const tree = await (await call("GET", "/projects/comfort/tree")).json();
    expect(tree.files.find((f: { path: string }) => f.path === "app/src/generated/A.cpp")).toMatchObject({ owned: true });
    expect(await (await call("GET", "/projects/comfort/file?path=app/src/generated/A.cpp")).json()).toEqual({ path: "app/src/generated/A.cpp", content });
    expect((await call("GET", "/projects/comfort/file?path=../../x")).status).toBe(404);
    expect(await (await call("GET", "/projects/comfort/generations")).json()).toEqual({ current: "g1", generations: ["g1"] });
    expect(await (await call("GET", "/projects/comfort/generations/g1/file?path=app/src/generated/A.cpp")).json()).toEqual({ path: "app/src/generated/A.cpp", content });
    const bad = await call("POST", "/projects/comfort/commits", { generationId: "g2", fileset: { ...fileset, files: [{ ...fileset.files[0], path: "app/src/x.cpp" }] } });
    expect(bad.status).toBe(422);
    for (const d of await bad.json()) expect(validator.validate("diagnostics", d).errors).toEqual([]);
    expect((await call("POST", "/projects/comfort/rollback", { generationId: "g1" })).status).toBe(200);
    expect((await call("POST", "/projects/comfort/rollback", { generationId: "nope" })).status).toBe(404);
    expect((await call("GET", "/projects/missing/tree")).status).toBe(404);
  });
});
