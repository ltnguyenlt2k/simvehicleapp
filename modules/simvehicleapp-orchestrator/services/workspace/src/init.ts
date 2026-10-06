import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resetSampleEntries } from "./manifest.ts";
import { normalizeRelative, PathRejected } from "./paths.ts";
import type { Store } from "./store.ts";

/**
 * Project creation (ADR-0026 §2, M07-T07): the toolchain's seeded template (tar) + the backend's
 * one-time overlay (minus the template files it replaces) + the vendored runtime + the VSS file of the
 * chosen release, assembled in staging and renamed into `projects/<slug>` in one step.
 */

export interface Bundle {
  runtimeVersion: string;
  files: { path: string; content: string }[];
  remove?: string[];
}

export interface InitSources {
  /** Template tar (`GET /templates?lang=` of the language's toolchain). */
  template(language: string): Promise<ReadableStream<Uint8Array>>;
  overlay(language: string): Promise<Bundle>;
  runtime(language: string): Promise<Bundle>;
  /** VSS release document text (`GET /vss?release=` of vss-catalog). */
  vss(release: string): Promise<string>;
}

export interface ProjectRequest {
  slug: string;
  language: "cpp" | "python" | "rust";
  appName: string;
  vssRelease: string;
}

export class ProjectExists extends Error {}
export class InitFailed extends Error {}

const RUNTIME_PREFIX: Record<string, string> = { cpp: "app/src/simvehicleapp-runtime/" };

async function untar(stream: ReadableStream<Uint8Array>, dir: string) {
  mkdirSync(dir, { recursive: true });
  // GNU/busybox tar refuse absolute names and `..` members by default.
  const proc = Bun.spawn(["tar", "-xf", "-", "-C", dir], { stdin: stream, stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new InitFailed(`template extraction failed: ${(await new Response(proc.stderr).text()).slice(0, 500)}`);
}

function writeIn(dir: string, rel: string, content: string) {
  const p = normalizeRelative(rel);
  const abs = join(dir, p);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

export async function initProject(store: Store, req: ProjectRequest, sources: InitSources): Promise<{ slug: string; appName: string; language: string; vssRelease: string; runtimeVersion: string }> {
  const target = store.projectDir(req.slug);
  if (existsSync(target)) throw new ProjectExists(`project ${req.slug} already exists`);
  if (!RUNTIME_PREFIX[req.language]) throw new InitFailed(`no ${req.language} backend in this installation`);
  const staging = join(store.metaDir, "staging", `init-${req.slug}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    await untar(await sources.template(req.language), staging);
    if (!existsSync(join(staging, ".velocitas.json"))) throw new InitFailed("the template has no .velocitas.json");

    const overlay = await sources.overlay(req.language);
    for (const rel of overlay.remove ?? []) rmSync(join(staging, normalizeRelative(rel)), { force: true });
    for (const f of overlay.files) writeIn(staging, f.path, f.content);

    const runtime = await sources.runtime(req.language);
    for (const f of runtime.files) {
      if (!f.path.startsWith(RUNTIME_PREFIX[req.language]!)) throw new PathRejected(f.path, "runtime file outside the runtime directory");
      writeIn(staging, f.path, f.content);
    }

    // AppManifest: the project's name and VSS file; the sample app's entries go with the sample app.
    const velocitas = JSON.parse(readFileSync(join(staging, ".velocitas.json"), "utf8")) as { variables?: { appManifestPath?: string } };
    const manifestRel = normalizeRelative(velocitas.variables?.appManifestPath ?? "app/AppManifest.json");
    const manifest = JSON.parse(resetSampleEntries(readFileSync(join(staging, manifestRel), "utf8"), req.appName)) as {
      interfaces: { type: string; config: { src?: string } }[];
    };
    const vsi = manifest.interfaces.find((i) => i.type === "vehicle-signal-interface");
    if (!vsi) throw new InitFailed("the template AppManifest has no vehicle-signal-interface");
    const vssRel = `app/vss/vss_rel_${req.vssRelease.slice(1)}.json`;
    if (vsi.config.src !== vssRel || !existsSync(join(staging, vssRel))) {
      const old = vsi.config.src && !/^[a-z]+:\/\//.test(vsi.config.src) ? vsi.config.src : null;
      writeIn(staging, vssRel, await sources.vss(req.vssRelease));
      if (old && old !== vssRel) rmSync(join(staging, normalizeRelative(old)), { force: true });
      vsi.config.src = vssRel;
    }
    writeFileSync(join(staging, manifestRel), `${JSON.stringify(manifest, null, 4)}\n`);

    const meta = { slug: req.slug, appName: req.appName, language: req.language, vssRelease: req.vssRelease, runtimeVersion: runtime.runtimeVersion };
    writeIn(staging, ".simvehicleapp/project.json", `${JSON.stringify(meta, null, 2)}\n`);
    writeIn(staging, ".simvehicleapp/manifest-managed.json", `${JSON.stringify({ datapoints: [], reads: [], writes: [] }, null, 2)}\n`);
    if (existsSync(target)) throw new ProjectExists(`project ${req.slug} already exists`);
    renameSync(staging, target);
    return meta;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
