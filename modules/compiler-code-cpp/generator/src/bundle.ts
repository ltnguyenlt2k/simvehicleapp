import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_VERSION } from "./project.ts";

/**
 * `GET /runtime/files` and `GET /template-overlay/files` (ADR-0020 §2, ADR-0021 §8): file bundles
 * read once from this module (`runtime/`, `template-overlay/`) — the only files the backend reads.
 */

export interface BundleFile {
  path: string;
  content: string;
  sha256: string;
  role: "source" | "header" | "test" | "build" | "config" | "doc";
}

export interface FileBundle {
  runtimeVersion: string;
  files: BundleFile[];
  remove?: string[];
}

export const MODULE_DIR = fileURLToPath(new URL("../../", import.meta.url));
export const RUNTIME_VENDOR_PATH = "app/src/simvehicleapp-runtime";

const roleOf = (p: string): BundleFile["role"] =>
  /\.(hpp|h)$/.test(p) ? "header" : /\.cpp$/.test(p) ? "source" : /(CMakeLists\.txt|\.cmake)$/.test(p) ? "build" : /\.md$/.test(p) ? "doc" : "config";

function walk(root: string, skip: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const rel = relative(root, abs).split("\\").join("/");
      if (skip(rel)) continue;
      if (statSync(abs).isDirectory()) visit(abs);
      else out.push(rel);
    }
  };
  visit(root);
  return out;
}

const bundleFile = (path: string, content: string): BundleFile => ({
  path,
  content,
  sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  role: roleOf(path),
});

/** The runtime library as vendored into a project (no unit tests, no build output). */
export function runtimeBundle(moduleDir = MODULE_DIR): FileBundle {
  const root = join(moduleDir, "runtime");
  const files = walk(root, (rel) => rel === "tests" || rel.startsWith("build") || rel.startsWith("."))
    .map((rel) => bundleFile(`${RUNTIME_VENDOR_PATH}/${rel}`, readFileSync(join(root, rel), "utf8")));
  return { runtimeVersion: RUNTIME_VERSION, files };
}

/** Files installed once into a new project + template files they replace. */
export function overlayBundle(moduleDir = MODULE_DIR): FileBundle {
  const root = join(moduleDir, "template-overlay");
  const meta = JSON.parse(readFileSync(join(root, "overlay.json"), "utf8")) as { remove: string[] };
  const files = walk(root, (rel) => rel === "overlay.json").map((rel) => bundleFile(rel, readFileSync(join(root, rel), "utf8")));
  return { runtimeVersion: RUNTIME_VERSION, files, remove: [...meta.remove].sort() };
}
