import { lstatSync } from "node:fs";
import { join, posix, resolve } from "node:path";

/**
 * Path policy of the workspace (ADR-0026 §3.1, analysis/14 §5): every path a request names is
 * relative, normalized, free of `..`, control characters and backslashes, inside an owned root (or
 * the AppManifest), and resolves inside the project without crossing a symlink.
 */

export class PathRejected extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${JSON.stringify(path)}: ${reason}`);
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A request path ⇒ its normalized relative form, or PathRejected. */
export function normalizeRelative(p: string): string {
  if (typeof p !== "string" || p.length === 0) throw new PathRejected(String(p), "empty path");
  if (p.length > 1024) throw new PathRejected(p.slice(0, 64), "path too long");
  if (CONTROL.test(p)) throw new PathRejected(p, "control character in path");
  if (p.includes("\\")) throw new PathRejected(p, "backslash in path");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new PathRejected(p, "absolute path");
  // contracts common `relativePath`: no `.`/`..` segment, no empty segment — rejected, never rewritten.
  const parts = p.split("/");
  if (parts.some((s) => s === "..")) throw new PathRejected(p, "parent directory segment");
  if (parts.some((s) => s === "." || s === "")) throw new PathRejected(p, "not a normalized path");
  return posix.normalize(p);
}

/** True when `rel` lies inside one of `roots` (each ends with `/`). */
export function insideRoots(rel: string, roots: readonly string[]): boolean {
  return roots.some((r) => rel.startsWith(r) && rel.length > r.length);
}

/**
 * The absolute path of `rel` in `projectDir`, refusing any existing symlink on the way (a symlink
 * could point outside the project or into another owned file).
 */
export function resolveInside(projectDir: string, rel: string): string {
  const base = resolve(projectDir);
  const abs = resolve(base, rel);
  if (!abs.startsWith(`${base}/`)) throw new PathRejected(rel, "outside the project");
  let cur = base;
  for (const seg of rel.split("/")) {
    cur = join(cur, seg);
    let st: ReturnType<typeof lstatSync> | undefined;
    try {
      st = lstatSync(cur);
    } catch {
      break; // the rest does not exist yet
    }
    if (st.isSymbolicLink()) throw new PathRejected(rel, "symbolic link in path");
  }
  return abs;
}

/** Owned root names are directories relative to the project, ending with `/`. */
export function validateRoots(roots: readonly string[]): string[] {
  return roots.map((r) => {
    if (!r.endsWith("/")) throw new PathRejected(r, "owned root must end with /");
    const n = normalizeRelative(r.slice(0, -1));
    return `${n}/`;
  });
}

/** Slugs of projects (contracts common `slug`). */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
