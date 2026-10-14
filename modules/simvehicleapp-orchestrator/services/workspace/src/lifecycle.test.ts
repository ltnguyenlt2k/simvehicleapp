import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspaceHandler } from "./app.ts";
import { levelOf, measureCapacity, thresholdsFromEnv } from "./capacity.ts";
import type { InitSources } from "./init.ts";
import { resetSampleEntries } from "./manifest.ts";
import { BUILD_OUTPUT, type FileSet, KEEP_GENERATIONS, Store } from "./store.ts";

/** Vehicle app lifecycle on the workspace (ADR-0053): delete, clean, size, capacity; plus the fixes found on the way. */

const SCRATCH = mkdtempSync(fileURLToPath(new URL("../.test-", import.meta.url)));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let n = 0;
const GB = 1024 ** 3;

const MANIFEST = `${JSON.stringify({ manifestVersion: "v3", name: "SampleApp", interfaces: [{ type: "vehicle-signal-interface", config: { src: "app/vss/vss_rel_4.0.json", datapoints: { required: [] } } }, { type: "pubsub", config: { reads: [], writes: [] } }] }, null, 4)}\n`;

function newProject(store: Store, slug = `p${n++}`) {
  const dir = store.projectDir(slug);
  mkdirSync(join(dir, ".simvehicleapp"), { recursive: true });
  mkdirSync(join(dir, "app/src"), { recursive: true });
  writeFileSync(join(dir, ".velocitas.json"), JSON.stringify({ variables: { appManifestPath: "app/AppManifest.json" } }));
  writeFileSync(join(dir, "app/AppManifest.json"), resetSampleEntries(MANIFEST, "ComfortApp"));
  writeFileSync(join(dir, ".simvehicleapp/project.json"), JSON.stringify({ slug, appName: "ComfortApp", language: "cpp", vssRelease: "v4.0" }));
  writeFileSync(join(dir, "app/src/main.cpp"), "int main() {}\n");
  return { slug, dir };
}

function fileset(files: Record<string, string>): FileSet {
  const entries = Object.entries(files).map(([path, content]) => ({ path, content, sha256: sha(content), role: "source" }));
  const gen = `${JSON.stringify({ manifestVersion: "1.0.0", backend: "cpp@0.1.0", runtimeVersion: "0.1.0", contracts: "1.0.0-alpha.1", workflows: [{ workflowId: "w", revision: 1, irHash: `sha256:${"a".repeat(64)}` }], ownedRoots: ["app/src/generated/", "app/tests/generated/"], files: entries.map((f) => ({ path: f.path, sha256: f.sha256, role: f.role })) })}\n`;
  entries.push({ path: "app/src/generated/simvehicleapp.gen.json", content: gen, sha256: sha(gen), role: "config" });
  return { backend: "cpp@0.1.0", runtimeVersion: "0.1.0", files: entries, ownedRoots: ["app/src/generated/", "app/tests/generated/"], manifestFragment: {}, sourceMaps: [], diagnostics: [] };
}

/** A C++ build as Velocitas leaves it: `build-linux-x86_64/` and the `build` link to it. */
function fakeBuild(dir: string, bytes: number) {
  mkdirSync(join(dir, "build-linux-x86_64/Debug/bin"), { recursive: true });
  writeFileSync(join(dir, "build-linux-x86_64/Debug/bin/app"), Buffer.alloc(bytes));
  symlinkSync("build-linux-x86_64/Debug", join(dir, "build"));
}

const noSources = {} as InitSources;

describe("delete (ADR-0053)", () => {
  test("removes the folder, its generation records and backups; other projects untouched; idempotent; slug reusable", async () => {
    const store = new Store(join(SCRATCH, "del"));
    const a = newProject(store, "app-a");
    const b = newProject(store, "app-b");
    await store.commit(a.slug, "g1", fileset({ "app/src/generated/A.cpp": "// 1\n" }));
    // a hand edit of a generated file, overwritten by the next SynCode: kept in backup/<gid>
    writeFileSync(join(a.dir, "app/src/generated/A.cpp"), "// edited\n");
    await store.commit(a.slug, "g2", fileset({ "app/src/generated/A.cpp": "// 2\n" }), true);
    expect(existsSync(join(store.metaDir, "backup", "g2"))).toBe(true);
    await store.commit(b.slug, "g9", fileset({ "app/src/generated/B.cpp": "// b\n" }));

    await store.deleteProject(a.slug);
    expect(existsSync(a.dir)).toBe(false);
    expect(existsSync(join(store.metaDir, "generations", a.slug))).toBe(false);
    expect(existsSync(join(store.metaDir, "backup", "g2"))).toBe(false);
    expect(existsSync(join(b.dir, "app/src/generated/B.cpp"))).toBe(true);
    expect(store.currentGeneration(b.slug)?.generationId).toBe("g9");
    await store.deleteProject(a.slug); // already gone
    expect(newProject(store, "app-a").slug).toBe("app-a");
  });

  test("HTTP: 204 (also when absent), 422 for an invalid slug, never outside projects/", async () => {
    const store = new Store(join(SCRATCH, "del-http"));
    const p = newProject(store);
    const h = createWorkspaceHandler(store, noSources);
    const del = (slug: string) => h(new Request(`http://ws/projects/${slug}`, { method: "DELETE" }), ctx);
    expect((await del(p.slug)).status).toBe(204);
    expect(existsSync(p.dir)).toBe(false);
    expect((await del(p.slug)).status).toBe(204);
    const bad = await del("..");
    expect(bad.status).toBe(404); // `..` is resolved away by the URL: never reaches a delete
    const upper = await del("Bad_Slug");
    expect(upper.status).toBe(422);
    expect((await upper.json())[0].code).toBe("WORKSPACE_PATH_REJECTED");
    expect(existsSync(store.projectsDir)).toBe(true);
  });

  test("waits for a commit of the same project (serialized)", async () => {
    const store = new Store(join(SCRATCH, "del-serial"));
    const p = newProject(store);
    const commit = store.commit(p.slug, "g1", fileset({ "app/src/generated/A.cpp": "// 1\n" }));
    const del = store.deleteProject(p.slug);
    await commit;
    await del;
    expect(existsSync(p.dir)).toBe(false);
    expect(readdirSync(join(store.metaDir, "staging"))).toEqual([]);
  });
});

describe("clean and size", () => {
  test("clean removes build outputs only (the link, not what it points to twice), sources stay; size reports both", async () => {
    const store = new Store(join(SCRATCH, "clean"));
    const p = newProject(store);
    fakeBuild(p.dir, 50_000);
    const before = store.projectSize(p.slug);
    expect(before.buildBytes).toBeGreaterThanOrEqual(50_000);
    expect(before.bytes).toBeGreaterThan(before.buildBytes);
    const h = createWorkspaceHandler(store, noSources);
    const r = await h(new Request(`http://ws/projects/${p.slug}/clean`, { method: "POST" }), ctx);
    expect(r.status).toBe(200);
    expect((await r.json()).freedBytes).toBe(before.buildBytes);
    expect(readdirSync(p.dir).filter((x) => BUILD_OUTPUT.test(x))).toEqual([]);
    expect(existsSync(join(p.dir, "app/src/main.cpp"))).toBe(true);
    expect(store.projectSize(p.slug).buildBytes).toBe(0);
    const size = await h(new Request(`http://ws/projects/${p.slug}/size`), ctx);
    expect(await size.json()).toEqual(store.projectSize(p.slug));
    expect((await h(new Request("http://ws/projects/nope/size"), ctx)).status).toBe(404);
  });

  test("a link pointing outside the project is removed, never followed", async () => {
    const store = new Store(join(SCRATCH, "clean-link"));
    const p = newProject(store);
    const outside = join(SCRATCH, "outside-keep");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "precious"), "x");
    symlinkSync(outside, join(p.dir, "build"));
    await store.cleanProject(p.slug);
    expect(existsSync(join(outside, "precious"))).toBe(true);
    expect(existsSync(join(p.dir, "build"))).toBe(false);
  });
});

describe("tree never follows symlinks (found while adding size)", () => {
  test("a link made in the IDE to a folder outside is not listed nor walked", () => {
    const store = new Store(join(SCRATCH, "tree"));
    const p = newProject(store);
    const outside = join(SCRATCH, "outside-tree");
    mkdirSync(join(outside, "deep"), { recursive: true });
    writeFileSync(join(outside, "deep/secret.txt"), "s");
    symlinkSync(outside, join(p.dir, "app/escape"));
    expect(store.tree(p.slug).map((f) => f.path)).not.toContain("app/escape/deep/secret.txt");
    expect(store.tree(p.slug).some((f) => f.path.startsWith("app/escape"))).toBe(false);
  });
});

describe("generation retention drops old backups too", () => {
  test(`only the last ${KEEP_GENERATIONS} generations keep a file set and a backup`, async () => {
    const store = new Store(join(SCRATCH, "keep"));
    const p = newProject(store);
    for (let i = 0; i <= KEEP_GENERATIONS + 1; i++) {
      if (i > 0) writeFileSync(join(p.dir, "app/src/generated/A.cpp"), `// hand edit ${i}\n`);
      await store.commit(p.slug, `g${i}`, fileset({ "app/src/generated/A.cpp": `// ${i}\n` }), true);
    }
    expect(existsSync(join(store.metaDir, "backup", "g1"))).toBe(false);
    expect(existsSync(join(store.metaDir, "backup", `g${KEEP_GENERATIONS + 1}`))).toBe(true);
  });
});

describe("capacity (disk watermarks)", () => {
  const t = thresholdsFromEnv({});
  test("defaults 10 / 5 / 2 GB, kept ordered whatever the env says", () => {
    expect(t).toEqual({ lowBytes: 10 * GB, highBytes: 5 * GB, floodBytes: 2 * GB });
    expect(thresholdsFromEnv({ SV_DISK_LOW_GB: "1", SV_DISK_HIGH_GB: "3", SV_DISK_FLOOD_GB: "4" })).toEqual({ lowBytes: 4 * GB, highBytes: 4 * GB, floodBytes: 4 * GB });
    expect(thresholdsFromEnv({ SV_DISK_FLOOD_GB: "abc" }).floodBytes).toBe(2 * GB);
  });
  test("levels", () => {
    expect([20, 9, 4, 1].map((g) => levelOf(g * GB, t))).toEqual(["ok", "low", "high", "flood"]);
  });
  test("measured with statfs (injected) and served by GET /capacity", async () => {
    const c = measureCapacity("/x", t, () => ({ bsize: 4096, bavail: (3 * GB) / 4096, blocks: (100 * GB) / 4096 }));
    expect(c).toEqual({ freeBytes: 3 * GB, totalBytes: 100 * GB, level: "high", thresholds: t });
    const store = new Store(join(SCRATCH, "cap"));
    const r = await createWorkspaceHandler(store, noSources, () => c)(new Request("http://ws/capacity"), ctx);
    expect(await r.json()).toEqual(c);
    const real = measureCapacity(store.projectsDir, t);
    expect(real.totalBytes).toBeGreaterThan(0);
  });
});
