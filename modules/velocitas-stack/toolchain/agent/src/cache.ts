import { createHash } from "node:crypto";
import { lstatSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Per-project Velocitas caches of this toolchain (ADR-0053): `~/.velocitas/projects/md5(<project path>)` holds the
 * project's vehicle model, cache.json and the link to the seed's shared venv (ADR-0051). They outlive deleted
 * projects unless removed here. The seed's own cache (the shared venv) is never removed; links are never followed.
 */
export interface CacheConfig {
  home: string;
  projectsDir: string;
  seedDir?: string;
  /** Caches touched more recently than this are kept (a project being created right now is not yet "alive"). */
  graceMs?: number;
  now?: () => number;
}

const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const cacheRoot = (c: CacheConfig) => join(c.home, ".velocitas", "projects");
export const cacheDirOf = (c: CacheConfig, slug: string) => join(cacheRoot(c), md5(resolve(c.projectsDir, slug)));

/** Bytes under `path`, never following a link. */
function bytes(path: string): number {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st) return 0;
  if (!st.isDirectory()) return st.size;
  return readdirSync(path).reduce((t, n) => t + bytes(join(path, n)), 0);
}

/** Removes the cache of one project; true when there was one. */
export function forget(c: CacheConfig, slug: string): boolean {
  const dir = cacheDirOf(c, slug);
  if (c.seedDir && dir === join(cacheRoot(c), md5(resolve(c.seedDir)))) return false;
  const existed = lstatSync(dir, { throwIfNoEntry: false }) !== undefined;
  rmSync(dir, { recursive: true, force: true });
  return existed;
}

/** Removes every project cache except those of `keep`, of the seed, and the ones touched within the grace period. */
export function gc(c: CacheConfig, keep: readonly string[]): { removed: number; freedBytes: number } {
  const root = cacheRoot(c);
  if (!lstatSync(root, { throwIfNoEntry: false })?.isDirectory()) return { removed: 0, freedBytes: 0 }; // e.g. the Rust toolchain
  const kept = new Set(keep.map((s) => md5(resolve(c.projectsDir, s))));
  if (c.seedDir) kept.add(md5(resolve(c.seedDir)));
  const now = (c.now ?? Date.now)();
  const grace = c.graceMs ?? 10 * 60_000;
  let removed = 0;
  let freedBytes = 0;
  for (const name of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && /^[0-9a-f]{32}$/.test(d.name))) {
    if (kept.has(name.name)) continue;
    const dir = join(root, name.name);
    if (now - lstatSync(dir).mtimeMs < grace) continue;
    freedBytes += bytes(dir);
    rmSync(dir, { recursive: true, force: true });
    removed++;
  }
  return { removed, freedBytes };
}
