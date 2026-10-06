import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ContractValidator } from "@simvehicleapp/contracts";
import { emptyManaged, type Fragment, type ManagedState, mergeManifest } from "./manifest.ts";
import { insideRoots, normalizeRelative, PathRejected, resolveInside, SLUG, validateRoots } from "./paths.ts";

/**
 * Project files on the workspace volume (ADR-0026): the only writer of `projects/**`. A generation
 * is committed through staging + journal + `rename` swaps, so a crash at any point leaves each
 * owned root either entirely old or entirely new (`recover()` at start-up finishes or undoes it).
 *
 *   <root>/projects/<slug>/                 project (template + overlay + runtime + generated)
 *   <root>/.sv/staging/<gid>/               files of a commit before the swap
 *   <root>/.sv/journal/<gid>.json           commit in progress
 *   <root>/.sv/backup/<gid>/                owned files edited by hand, saved before overwriting
 *   <root>/.sv/generations/<slug>/          generation records (+ file sets of the last 10)
 */

/** Owned roots a backend may write (ADR-0023 §3). */
export const ALLOWED_ROOTS = ["app/src/generated/", "app/tests/generated/"];
export const KEEP_GENERATIONS = 10;

export interface FileSet {
  backend: string;
  runtimeVersion: string;
  files: { path: string; content: string; sha256: string; role: string }[];
  ownedRoots: string[];
  manifestFragment: Fragment;
  sourceMaps: unknown[];
  diagnostics: unknown[];
}

export interface GenerationRecord {
  manifestVersion: "1.0.0";
  generationId: string;
  project: string;
  backend: string;
  runtimeVersion: string;
  contracts: string;
  workflows: { workflowId: string; revision: number; irHash: string }[];
  ownedRoots: string[];
  files: { path: string; sha256: string; role?: string }[];
}

export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  stage: "workspace";
  message: string;
  docs: string;
  data?: Record<string, unknown>;
}

export class CommitRejected extends Error {
  constructor(
    readonly status: 409 | 422,
    readonly diagnostics: Diagnostic[],
  ) {
    super(diagnostics.map((d) => d.message).join("; "));
  }
}

/** Fault injection (ADR-0026 Verification): the commit "dies" at this point. */
export type CrashPoint = "afterStaging" | "midSwap" | "afterSwap";
export class Crash extends Error {}

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const validator = new ContractValidator();
/** The generation manifest every backend ships with its code (contracts generation-manifest). */
export const GEN_MANIFEST = "simvehicleapp.gen.json";
const diag = (code: string, severity: Diagnostic["severity"], message: string, data?: Record<string, unknown>): Diagnostic => ({
  code,
  severity,
  stage: "workspace",
  message,
  docs: `diagnostics#${code}`,
  ...(data ? { data } : {}),
});

function writeDurable(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "w");
  try {
    writeFileSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(path: string) {
  try {
    const fd = openSync(path, "r");
    fsyncSync(fd);
    closeSync(fd);
  } catch {
    // some filesystems do not allow fsync on directories
  }
}

function listFiles(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split("\\").join("/"));
  }
  return out;
}

export class Store {
  readonly projectsDir: string;
  readonly metaDir: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    private readonly crashAt?: CrashPoint,
  ) {
    this.projectsDir = join(root, "projects");
    this.metaDir = join(root, ".sv");
    for (const d of ["staging", "journal", "backup", "generations"]) mkdirSync(join(this.metaDir, d), { recursive: true });
    mkdirSync(this.projectsDir, { recursive: true });
  }

  projectDir(slug: string): string {
    if (!SLUG.test(slug)) throw new PathRejected(slug, "invalid project slug");
    return join(this.projectsDir, slug);
  }

  exists(slug: string): boolean {
    return existsSync(join(this.projectDir(slug), ".simvehicleapp", "project.json"));
  }

  project(slug: string): { slug: string; appName: string; language: string; vssRelease: string } {
    return JSON.parse(readFileSync(join(this.projectDir(slug), ".simvehicleapp", "project.json"), "utf8"));
  }

  /** Path of the AppManifest (`.velocitas.json` `appManifestPath`, ADR-0023 §2). */
  manifestPath(slug: string): string {
    const dir = this.projectDir(slug);
    let rel = "app/AppManifest.json";
    try {
      rel = JSON.parse(readFileSync(join(dir, ".velocitas.json"), "utf8")).variables?.appManifestPath ?? rel;
    } catch {}
    return normalizeRelative(rel);
  }

  /** One commit per project at a time. */
  async serialize<T>(slug: string, fn: () => T | Promise<T>): Promise<T> {
    const prev = this.locks.get(slug) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(slug, next.catch(() => {}));
    return next;
  }

  // ---- generations ---------------------------------------------------------------------------
  private genDir(slug: string) {
    return join(this.metaDir, "generations", slug);
  }

  currentGeneration(slug: string): GenerationRecord | null {
    const p = join(this.genDir(slug), "current");
    if (!existsSync(p)) return null;
    const gid = readFileSync(p, "utf8").trim();
    return this.generation(slug, gid);
  }

  generation(slug: string, gid: string): GenerationRecord | null {
    const p = join(this.genDir(slug), `${gid}.json`);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }

  /** Retained generation ids, oldest first. */
  generationIds(slug: string): string[] {
    const p = join(this.genDir(slug), "index.json");
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as string[]) : [];
  }

  storedFileSet(slug: string, gid: string): FileSet | null {
    const p = join(this.genDir(slug), `${gid}.fileset.json.gz`);
    return existsSync(p) ? JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) : null;
  }

  /** Owned files that differ from what the current generation wrote (GENERATED_FILE_MODIFIED, ADR-0026 §3.2). */
  modifiedFiles(slug: string, roots: readonly string[]): string[] {
    const dir = this.projectDir(slug);
    const prev = this.currentGeneration(slug);
    const known = new Map((prev?.files ?? []).map((f) => [f.path, f.sha256]));
    const out: string[] = [];
    const onDisk = new Set<string>();
    for (const r of roots) for (const f of listFiles(join(dir, r))) onDisk.add(`${r}${f}`);
    for (const p of [...onDisk].sort()) {
      const want = known.get(p);
      if (!want || sha256(readFileSync(join(dir, p))) !== want) out.push(p);
    }
    for (const p of known.keys()) if (insideRoots(p, roots) && !onDisk.has(p)) out.push(p);
    return [...new Set(out)].sort();
  }

  // ---- commit -------------------------------------------------------------------------------------
  /** Validates a file set (paths, roots, hashes) before anything is written. */
  validate(fs: FileSet): string[] {
    const roots = validateRoots(fs.ownedRoots);
    for (const r of roots) {
      if (!ALLOWED_ROOTS.includes(r)) throw new CommitRejected(422, [diag("WORKSPACE_PATH_REJECTED", "error", `${r} is not a root a backend may own`, { path: r })]);
    }
    const seen = new Set<string>();
    for (const f of fs.files) {
      let p: string;
      try {
        p = normalizeRelative(f.path);
      } catch (e) {
        const r = e as PathRejected;
        throw new CommitRejected(422, [diag("WORKSPACE_PATH_REJECTED", "error", `${r.path} rejected: ${r.reason}`, { path: r.path, reason: r.reason })]);
      }
      if (p !== f.path || !insideRoots(p, roots)) throw new CommitRejected(422, [diag("WORKSPACE_PATH_REJECTED", "error", `${f.path} is outside the owned roots`, { path: f.path })]);
      if (seen.has(p)) throw new CommitRejected(422, [diag("WORKSPACE_PATH_REJECTED", "error", `${p} appears twice`, { path: p })]);
      seen.add(p);
      if (sha256(f.content) !== f.sha256) throw new CommitRejected(422, [diag("WORKSPACE_COMMIT_FAILED", "error", `${p}: content does not match its sha256`, { path: p })]);
    }
    const gen = fs.files.filter((f) => f.path.endsWith(`/${GEN_MANIFEST}`));
    let genDoc: unknown;
    try {
      genDoc = gen.length === 1 ? JSON.parse(gen[0]!.content) : undefined;
    } catch {}
    const v = genDoc === undefined ? null : validator.validate("generation-manifest", genDoc);
    if (!v?.valid) {
      throw new CommitRejected(422, [diag("WORKSPACE_COMMIT_FAILED", "error", `the file set must hold one valid ${GEN_MANIFEST} (contracts generation-manifest)`, { files: gen.map((f) => f.path) })]);
    }
    return roots;
  }

  commit(slug: string, gid: string, fs: FileSet, overwriteModified = false): Promise<GenerationRecord> {
    return this.serialize(slug, () => this.commitNow(slug, gid, fs, overwriteModified));
  }

  private commitNow(slug: string, gid: string, fs: FileSet, overwriteModified: boolean): GenerationRecord {
    if (!this.exists(slug)) throw new CommitRejected(422, [diag("WORKSPACE_COMMIT_FAILED", "error", `project ${slug} does not exist`)]);
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(gid)) throw new CommitRejected(422, [diag("WORKSPACE_COMMIT_FAILED", "error", "invalid generation id")]);
    const roots = this.validate(fs);
    const dir = this.projectDir(slug);
    for (const r of roots) resolveInside(dir, r.slice(0, -1)); // no symlinked owned root
    const manifestRel = this.manifestPath(slug);
    resolveInside(dir, manifestRel);

    // 2. hand edits of owned files
    const modified = this.modifiedFiles(slug, roots);
    if (modified.length && !overwriteModified) {
      throw new CommitRejected(
        409,
        modified.slice(0, 50).map((p) => diag("GENERATED_FILE_MODIFIED", "warning", `${p} was changed outside SimVehicleApp`, { path: p })),
      );
    }
    if (modified.length) {
      for (const p of modified) {
        const src = join(dir, p);
        if (existsSync(src)) writeDurable(join(this.metaDir, "backup", gid, p), readFileSync(src));
      }
    }

    // 3. staging (the full new content of every owned root) + merged AppManifest
    const staging = join(this.metaDir, "staging", gid);
    rmSync(staging, { recursive: true, force: true });
    for (const r of roots) mkdirSync(join(staging, "roots", r), { recursive: true });
    for (const f of fs.files) writeDurable(join(staging, "roots", f.path), f.content);
    const project = this.project(slug);
    const manifestAbs = join(dir, manifestRel);
    const managedAbs = join(dir, ".simvehicleapp", "manifest-managed.json");
    const before = existsSync(manifestAbs) ? readFileSync(manifestAbs, "utf8") : null;
    const managedBefore: ManagedState = existsSync(managedAbs) ? JSON.parse(readFileSync(managedAbs, "utf8")) : emptyManaged();
    const merged = mergeManifest(before, project.appName, fs.manifestFragment ?? {}, managedBefore);
    writeDurable(join(staging, "manifest.new"), merged.text);
    if (before !== null) writeDurable(join(staging, "manifest.old"), before);
    writeDurable(join(staging, "managed.new"), `${JSON.stringify(merged.managed, null, 2)}\n`);
    if (existsSync(managedAbs)) writeDurable(join(staging, "managed.old"), readFileSync(managedAbs));
    writeDurable(join(staging, "fileset.json.gz"), gzipSync(JSON.stringify(fs)));
    fsyncDir(staging);
    const journal = join(this.metaDir, "journal", `${gid}.json`);
    writeDurable(journal, JSON.stringify({ gid, slug, roots, manifest: manifestRel, phase: "prepared" }));
    if (this.crashAt === "afterStaging") throw new Crash("crash after staging");

    // 5. swap
    roots.forEach((r, i) => {
      const abs = join(dir, r.slice(0, -1));
      mkdirSync(dirname(abs), { recursive: true });
      if (existsSync(abs)) renameSync(abs, `${abs}.old-${gid}`);
      if (this.crashAt === "midSwap" && i === 0) throw new Crash("crash in the middle of the swap");
      renameSync(join(staging, "roots", r.slice(0, -1)), abs);
    });
    renameSync(join(staging, "manifest.new"), manifestAbs);
    mkdirSync(dirname(managedAbs), { recursive: true });
    renameSync(join(staging, "managed.new"), managedAbs);
    fsyncDir(dir);
    writeDurable(journal, JSON.stringify({ gid, slug, roots, manifest: manifestRel, phase: "swapped" }));
    if (this.crashAt === "afterSwap") throw new Crash("crash after the swap");

    // 6. record + cleanup
    return this.finishCommit(slug, gid, roots);
  }

  private finishCommit(slug: string, gid: string, roots: string[]): GenerationRecord {
    const dir = this.projectDir(slug);
    const staging = join(this.metaDir, "staging", gid);
    const fs = JSON.parse(gunzipSync(readFileSync(join(staging, "fileset.json.gz"))).toString("utf8")) as FileSet;
    const genJson = JSON.parse(fs.files.find((f) => f.path.endsWith(`/${GEN_MANIFEST}`))!.content) as GenerationRecord;
    const record: GenerationRecord = {
      manifestVersion: "1.0.0",
      generationId: gid,
      project: slug,
      backend: fs.backend,
      runtimeVersion: fs.runtimeVersion,
      contracts: genJson.contracts,
      workflows: genJson.workflows,
      ownedRoots: roots,
      files: fs.files.map((f) => ({ path: f.path, sha256: f.sha256, role: f.role })).sort((a, b) => (a.path < b.path ? -1 : 1)),
    };
    const g = this.genDir(slug);
    writeDurable(join(g, `${gid}.json`), `${JSON.stringify(record, null, 2)}\n`);
    writeDurable(join(g, `${gid}.fileset.json.gz`), readFileSync(join(staging, "fileset.json.gz")));
    const indexPath = join(g, "index.json");
    const index = (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : []) as string[];
    const next = [...index.filter((x) => x !== gid), gid];
    for (const old of next.slice(0, Math.max(0, next.length - KEEP_GENERATIONS))) {
      rmSync(join(g, `${old}.fileset.json.gz`), { force: true });
    }
    writeDurable(indexPath, JSON.stringify(next));
    writeDurable(join(g, "current"), `${gid}\n`);
    for (const r of roots) rmSync(join(dir, `${r.slice(0, -1)}.old-${gid}`), { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    rmSync(join(this.metaDir, "journal", `${gid}.json`), { force: true });
    return record;
  }

  /** Start-up recovery: a commit that did not reach "swapped" is undone, a swapped one is finished. */
  recover(): { rolledBack: string[]; finished: string[] } {
    const rolledBack: string[] = [];
    const finished: string[] = [];
    for (const name of readdirSync(join(this.metaDir, "journal")).sort()) {
      const j = JSON.parse(readFileSync(join(this.metaDir, "journal", name), "utf8")) as { gid: string; slug: string; roots: string[]; manifest: string; phase: string };
      const dir = this.projectDir(j.slug);
      const staging = join(this.metaDir, "staging", j.gid);
      if (j.phase === "swapped") {
        this.finishCommit(j.slug, j.gid, j.roots);
        finished.push(j.gid);
        continue;
      }
      for (const r of j.roots) {
        const abs = join(dir, r.slice(0, -1));
        const old = `${abs}.old-${j.gid}`;
        if (existsSync(old)) {
          rmSync(abs, { recursive: true, force: true });
          renameSync(old, abs);
        } else if (existsSync(join(staging, "roots", r.slice(0, -1)))) {
          // not swapped yet: the current root is the old one
        }
      }
      const manifestAbs = join(dir, j.manifest);
      if (existsSync(join(staging, "manifest.old")) && !existsSync(join(staging, "manifest.new"))) renameSync(join(staging, "manifest.old"), manifestAbs);
      const managedAbs = join(dir, ".simvehicleapp", "manifest-managed.json");
      if (existsSync(join(staging, "managed.old")) && !existsSync(join(staging, "managed.new"))) renameSync(join(staging, "managed.old"), managedAbs);
      rmSync(staging, { recursive: true, force: true });
      rmSync(join(this.metaDir, "journal", name), { force: true });
      rolledBack.push(j.gid);
    }
    // stray staging directories of commits that never wrote a journal
    for (const name of readdirSync(join(this.metaDir, "staging"))) {
      if (!existsSync(join(this.metaDir, "journal", `${name}.json`))) rmSync(join(this.metaDir, "staging", name), { recursive: true, force: true });
    }
    return { rolledBack, finished };
  }

  /** Re-commits the file set of a retained generation (ADR-0026 §4). */
  rollback(slug: string, gid: string): Promise<GenerationRecord | null> {
    const fs = this.storedFileSet(slug, gid);
    if (!fs) return Promise.resolve(null);
    return this.commit(slug, gid, fs, true);
  }

  /** Files of the project for the UI (no build outputs, no VCS). */
  tree(slug: string): { path: string; size: number; owned: boolean }[] {
    const dir = this.projectDir(slug);
    const skip = (rel: string) => /^(build|build-[^/]*|\.git|\.velocitas[^/]*cache)(\/|$)/.test(rel);
    return listFiles(dir)
      .filter((p) => !skip(p))
      .map((p) => ({ path: p, size: statSync(join(dir, p)).size, owned: insideRoots(p, ALLOWED_ROOTS) }));
  }

  /** One text file for the read-only viewer (≤ 1 MB). */
  readFile(slug: string, rel: string): string {
    const p = normalizeRelative(rel);
    const abs = resolveInside(this.projectDir(slug), p);
    const st = statSync(abs, { throwIfNoEntry: false });
    if (!st || !st.isFile()) throw new PathRejected(rel, "no such file");
    if (st.size > 1024 * 1024) throw new PathRejected(rel, "file too large to view");
    return readFileSync(abs, "utf8");
  }
}
