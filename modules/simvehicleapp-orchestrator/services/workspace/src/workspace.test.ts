import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractValidator } from "@simvehicleapp/contracts";
import { emptyManaged, mergeManifest, resetSampleEntries } from "./manifest.ts";
import { normalizeRelative, PathRejected, resolveInside } from "./paths.ts";
import { CommitRejected, Crash, type CrashPoint, type FileSet, KEEP_GENERATIONS, Store } from "./store.ts";

const validator = new ContractValidator();
const SCRATCH = mkdtempSync(fileURLToPath(new URL("../.test-", import.meta.url)));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
let n = 0;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const TEMPLATE_MANIFEST = `${JSON.stringify(
  {
    manifestVersion: "v3",
    name: "SampleApp",
    interfaces: [
      { type: "vehicle-signal-interface", config: { src: "app/vss/vss_rel_4.0.json", datapoints: { required: [{ path: "Vehicle.Speed", required: "true", access: "read" }] } } },
      { type: "pubsub", config: { reads: ["sampleapp/getSpeed"], writes: ["sampleapp/currentSpeed"] } },
    ],
  },
  null,
  4,
)}\n`;

/** A project as the workspace creates it (template files + project.json), without the network. */
function newProject(store: Store, slug = `p${n++}`) {
  const dir = store.projectDir(slug);
  mkdirSync(join(dir, ".simvehicleapp"), { recursive: true });
  mkdirSync(join(dir, "app/src"), { recursive: true });
  writeFileSync(join(dir, ".velocitas.json"), JSON.stringify({ variables: { appManifestPath: "app/AppManifest.json" } }));
  writeFileSync(join(dir, "app/AppManifest.json"), resetSampleEntries(TEMPLATE_MANIFEST, "ComfortApp"));
  writeFileSync(join(dir, ".simvehicleapp/project.json"), JSON.stringify({ slug, appName: "ComfortApp", language: "cpp", vssRelease: "v4.0" }));
  return { slug, dir };
}

/** A file set as a backend returns it, with its `simvehicleapp.gen.json` (contracts generation-manifest). */
function fileset(files: Record<string, string>, fragment: FileSet["manifestFragment"] = {}): FileSet {
  const entries = Object.entries(files).map(([path, content]) => ({ path, content, sha256: sha(content), role: "source" }));
  const gen = `${JSON.stringify({
    manifestVersion: "1.0.0",
    backend: "cpp@0.1.0",
    runtimeVersion: "0.1.0",
    contracts: "1.0.0-alpha.1",
    workflows: [{ workflowId: "gw_a", revision: 1, irHash: `sha256:${"a".repeat(64)}` }],
    ownedRoots: ["app/src/generated/", "app/tests/generated/"],
    files: entries.map((f) => ({ path: f.path, sha256: f.sha256, role: f.role })),
  })}\n`;
  entries.push({ path: "app/src/generated/simvehicleapp.gen.json", content: gen, sha256: sha(gen), role: "config" });
  return { backend: "cpp@0.1.0", runtimeVersion: "0.1.0", files: entries, ownedRoots: ["app/src/generated/", "app/tests/generated/"], manifestFragment: fragment, sourceMaps: [], diagnostics: [] };
}

const read = (dir: string, p: string) => readFileSync(join(dir, p), "utf8");

describe("path policy (ADR-0026 §3.1, analysis/14 §5)", () => {
  test("absolute, parent, dot, empty segments, backslash and control characters are rejected", () => {
    for (const p of ["/etc/passwd", "../../etc/passwd", "app/../x", "app/./x", "app//x", "app\\x", "a\u0000b", "C:/x", "", "app/"]) {
      expect(() => normalizeRelative(p)).toThrow(PathRejected);
    }
    expect(normalizeRelative("app/src/generated/A.cpp")).toBe("app/src/generated/A.cpp");
  });

  test("a symlink anywhere on the path is refused (no escape, no write through a link)", () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { dir } = newProject(store);
    mkdirSync(join(SCRATCH, "outside"), { recursive: true });
    symlinkSync(join(SCRATCH, "outside"), join(dir, "app/src/generated"));
    expect(() => resolveInside(dir, "app/src/generated/A.cpp")).toThrow("symbolic link");
  });
});

describe("AppManifest merge (ADR-0023 §4, M07-T09)", () => {
  const fragment = {
    "vehicle-signal-interface": { required: [{ path: "Vehicle.Speed", access: "read" as const }, { path: "Vehicle.Body.Lights.Hazard.IsSignaling", access: "write" as const }] },
    pubsub: { reads: [], writes: ["simvehicleapp/comfort/hmi"] },
  };

  test("sample entries go at creation; managed entries are marked, sorted; the same merge twice is byte-identical", () => {
    const base = resetSampleEntries(TEMPLATE_MANIFEST, "ComfortApp");
    const once = mergeManifest(base, "ComfortApp", fragment, emptyManaged());
    const twice = mergeManifest(once.text, "ComfortApp", fragment, once.managed);
    expect(twice.text).toBe(once.text);
    const doc = JSON.parse(once.text);
    expect(doc.name).toBe("ComfortApp");
    expect(doc.interfaces[0].config.src).toBe("app/vss/vss_rel_4.0.json");
    expect(doc.interfaces[0].config.datapoints.required).toEqual([
      { path: "Vehicle.Body.Lights.Hazard.IsSignaling", required: "true", access: "write", "x-sv-managed": true },
      { path: "Vehicle.Speed", required: "true", access: "read", "x-sv-managed": true },
    ]);
    expect(doc.interfaces[1].config).toEqual({ reads: [], writes: ["simvehicleapp/comfort/hmi"] });
    expect(once.text.startsWith('{\n    "manifestVersion": "v3"')).toBe(true);
    expect(once.text.endsWith("}\n")).toBe(true);
  });

  test("entries added by hand stay; a disabled workflow's managed entries go; a written hand entry gets write access", () => {
    const base = mergeManifest(resetSampleEntries(TEMPLATE_MANIFEST, "ComfortApp"), "ComfortApp", fragment, emptyManaged());
    const doc = JSON.parse(base.text);
    doc.interfaces[0].config.datapoints.required.push({ path: "Vehicle.Cabin.Door.Row1.DriverSide.IsOpen", required: "true", access: "read" });
    doc.interfaces[1].config.reads.push("my/own/topic");
    const edited = `${JSON.stringify(doc, null, 4)}\n`;
    const next = mergeManifest(edited, "ComfortApp", { "vehicle-signal-interface": { required: [{ path: "Vehicle.Cabin.Door.Row1.DriverSide.IsOpen", access: "write" }] }, pubsub: { reads: [], writes: [] } }, base.managed);
    const out = JSON.parse(next.text);
    expect(out.interfaces[0].config.datapoints.required).toEqual([{ path: "Vehicle.Cabin.Door.Row1.DriverSide.IsOpen", required: "true", access: "write" }]);
    expect(out.interfaces[1].config).toEqual({ reads: ["my/own/topic"], writes: [] });
    expect(next.managed).toEqual({ datapoints: [], reads: [], writes: [] });
  });
});

describe("atomic commit (ADR-0026 §3, M07-T08/T10/T11)", () => {
  test("commit writes the owned roots + merged manifest; the record validates; a second identical commit changes no byte", async () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { slug, dir } = newProject(store);
    const fs = fileset({ "app/src/generated/A.cpp": "int a;\n", "app/tests/generated/A_test.cpp": "// t\n" }, { pubsub: { writes: ["x/hmi"] } });
    const rec = await store.commit(slug, "g1", fs);
    expect(validator.validate("generation-manifest", rec).errors).toEqual([]);
    expect(rec.workflows).toEqual([{ workflowId: "gw_a", revision: 1, irHash: `sha256:${"a".repeat(64)}` }]);
    expect(read(dir, "app/src/generated/A.cpp")).toBe("int a;\n");
    expect(JSON.parse(read(dir, "app/AppManifest.json")).interfaces[1].config.writes).toEqual(["x/hmi"]);
    const snapshot = () => Object.fromEntries(store.tree(slug).map((f) => [f.path, read(dir, f.path)]));
    const before = snapshot();
    await store.commit(slug, "g2", fs);
    expect(snapshot()).toEqual(before);
    expect(readdirSync(join(store.metaDir, "staging"))).toEqual([]);
    expect(readdirSync(join(store.metaDir, "journal"))).toEqual([]);
  });

  test("files outside the owned roots, bad hashes, foreign roots are rejected before anything is written", async () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { slug } = newProject(store);
    const bad = fileset({ "app/src/CMakeLists.txt": "x" });
    await expect(store.commit(slug, "g1", bad)).rejects.toMatchObject({ status: 422, diagnostics: [{ code: "WORKSPACE_PATH_REJECTED" }] });
    const traversal = fileset({ "app/src/generated/../../evil": "x" });
    await expect(store.commit(slug, "g1", traversal)).rejects.toBeInstanceOf(CommitRejected);
    const hash = fileset({ "app/src/generated/A.cpp": "x" });
    hash.files[0]!.sha256 = "0".repeat(64);
    await expect(store.commit(slug, "g1", hash)).rejects.toMatchObject({ diagnostics: [{ code: "WORKSPACE_COMMIT_FAILED" }] });
    const roots = { ...fileset({}), ownedRoots: [".github/"] };
    const noGen = fileset({ "app/src/generated/A.cpp": "x" });
    noGen.files = noGen.files.filter((f) => !f.path.endsWith("simvehicleapp.gen.json"));
    await expect(store.commit(slug, "g1", noGen)).rejects.toMatchObject({ diagnostics: [{ code: "WORKSPACE_COMMIT_FAILED" }] });
    await expect(store.commit(slug, "g1", roots)).rejects.toMatchObject({ diagnostics: [{ code: "WORKSPACE_PATH_REJECTED" }] });
  });

  test("owned files edited by hand ⇒ 409 GENERATED_FILE_MODIFIED; with overwrite they are backed up first", async () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { slug, dir } = newProject(store);
    await store.commit(slug, "g1", fileset({ "app/src/generated/A.cpp": "int a;\n" }));
    writeFileSync(join(dir, "app/src/generated/A.cpp"), "int a; // mine\n");
    writeFileSync(join(dir, "app/src/generated/Extra.cpp"), "x\n");
    const next = fileset({ "app/src/generated/A.cpp": "int a = 1;\n" });
    const err = await store.commit(slug, "g2", next).catch((e) => e);
    expect(err).toBeInstanceOf(CommitRejected);
    expect(err.status).toBe(409);
    expect(err.diagnostics.map((d: { data: { path: string } }) => d.data.path)).toEqual(["app/src/generated/A.cpp", "app/src/generated/Extra.cpp"]);
    for (const d of err.diagnostics) expect(validator.validate("diagnostics", d).errors).toEqual([]);
    await store.commit(slug, "g2", next, true);
    expect(read(dir, "app/src/generated/A.cpp")).toBe("int a = 1;\n");
    expect(existsSync(join(dir, "app/src/generated/Extra.cpp"))).toBe(false);
    expect(readFileSync(join(store.metaDir, "backup/g2/app/src/generated/A.cpp"), "utf8")).toBe("int a; // mine\n");
  });

  for (const point of ["afterStaging", "midSwap", "afterSwap"] as CrashPoint[]) {
    test(`kill during the commit (${point}) ⇒ recovery leaves the project entirely old or entirely new`, async () => {
      const root = join(SCRATCH, `ws${n++}`);
      const ok = new Store(root);
      const { slug, dir } = newProject(ok);
      await ok.commit(slug, "g1", fileset({ "app/src/generated/A.cpp": "old\n", "app/tests/generated/T.cpp": "old\n" }, { pubsub: { writes: ["old/topic"] } }));
      const manifestOld = read(dir, "app/AppManifest.json");
      const dying = new Store(root, point);
      const next = fileset({ "app/src/generated/A.cpp": "new\n", "app/tests/generated/T.cpp": "new\n" }, { pubsub: { writes: ["new/topic"] } });
      await expect(dying.commit(slug, "g2", next)).rejects.toBeInstanceOf(Crash);
      const restarted = new Store(root);
      const r = restarted.recover();
      const a = read(dir, "app/src/generated/A.cpp");
      const t = read(dir, "app/tests/generated/T.cpp");
      expect(a).toBe(t); // both roots from the same generation
      if (point === "afterSwap") {
        expect(r.finished).toEqual(["g2"]);
        expect(a).toBe("new\n");
        expect(restarted.currentGeneration(slug)?.generationId).toBe("g2");
        expect(JSON.parse(read(dir, "app/AppManifest.json")).interfaces[1].config.writes).toEqual(["new/topic"]);
      } else {
        expect(r.rolledBack).toEqual(["g2"]);
        expect(a).toBe("old\n");
        expect(read(dir, "app/AppManifest.json")).toBe(manifestOld);
        expect(restarted.currentGeneration(slug)?.generationId).toBe("g1");
      }
      expect(readdirSync(join(dir, "app/src")).filter((x) => x.includes(".old-"))).toEqual([]);
      expect(restarted.modifiedFiles(slug, ["app/src/generated/", "app/tests/generated/"])).toEqual([]);
      // the project still commits normally afterwards
      await restarted.commit(slug, "g3", next, true);
      expect(read(dir, "app/src/generated/A.cpp")).toBe("new\n");
    });
  }

  test(`rollback re-commits a retained generation; only the last ${KEEP_GENERATIONS} file sets are kept`, async () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { slug, dir } = newProject(store);
    for (let i = 1; i <= KEEP_GENERATIONS + 2; i++) await store.commit(slug, `g${i}`, fileset({ "app/src/generated/A.cpp": `v${i}\n` }));
    expect(store.storedFileSet(slug, "g1")).toBeNull();
    expect(await store.rollback(slug, "g1")).toBeNull();
    const rec = await store.rollback(slug, "g5");
    expect(rec?.generationId).toBe("g5");
    expect(read(dir, "app/src/generated/A.cpp")).toBe("v5\n");
    expect(store.currentGeneration(slug)?.generationId).toBe("g5");
  });

  test("tree marks owned files and hides build outputs; the viewer reads text files inside the project only", async () => {
    const store = new Store(join(SCRATCH, `ws${n++}`));
    const { slug, dir } = newProject(store);
    await store.commit(slug, "g1", fileset({ "app/src/generated/A.cpp": "int a;\n" }));
    mkdirSync(join(dir, "build/bin"), { recursive: true });
    writeFileSync(join(dir, "build/bin/app"), "x");
    const tree = store.tree(slug);
    expect(tree.find((f) => f.path === "app/src/generated/A.cpp")).toEqual({ path: "app/src/generated/A.cpp", size: 7, owned: true });
    expect(tree.some((f) => f.path.startsWith("build/"))).toBe(false);
    expect(store.readFile(slug, "app/src/generated/A.cpp")).toBe("int a;\n");
    expect(() => store.readFile(slug, "../../etc/passwd")).toThrow(PathRejected);
    expect(() => store.projectDir("../x")).toThrow(PathRejected);
  });
});
