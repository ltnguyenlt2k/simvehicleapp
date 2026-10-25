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
  /** Languages with both a backend and a toolchain in this installation (`SV_BACKENDS` ∩ `SV_TOOLCHAINS`). */
  languages(): string[];
  /** Template tar (`GET /templates?lang=` of the language's toolchain). */
  template(language: string): Promise<ReadableStream<Uint8Array>>;
  overlay(language: string): Promise<Bundle>;
  runtime(language: string): Promise<Bundle>;
  /** VSS release document text (`GET /vss?release=` of vss-catalog). */
  vss(release: string): Promise<string>;
  /** The release's units.yaml (`GET /units?release=`), or null when it ships none (the generator's default applies). */
  units?(release: string): Promise<string | null>;
}

export interface ProjectRequest {
  slug: string;
  language: "cpp" | "python" | "rust";
  /** What the app runs on (ADR-0061): its template, overlay and runtime come from the `<language>-wasm` sources. */
  target?: "velocitas" | "wasm";
  appName: string;
  vssRelease: string;
}

export class ProjectExists extends Error {}
export class InitFailed extends Error {}

/** Units file of the project's VSS release (AppManifest vehicle-signal-interface `unit_src`). */
const UNITS_REL = "app/vss/units.yaml";

/** Every backend vendors its runtime here (backend.yaml `runtime.vendorPath`, ADR-0021 §8). */
const RUNTIME_PREFIX = "app/src/simvehicleapp-runtime/";

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
  const key = req.target === "wasm" ? `${req.language}-wasm` : req.language;
  if (!sources.languages().includes(key)) throw new InitFailed(`no ${key} backend in this installation`);
  const staging = join(store.metaDir, "staging", `init-${req.slug}-${crypto.randomUUID().slice(0, 8)}`);
  try {
    await untar(await sources.template(key), staging);
    if (!existsSync(join(staging, ".velocitas.json"))) throw new InitFailed("the template has no .velocitas.json");

    const overlay = await sources.overlay(key);
    for (const rel of overlay.remove ?? []) rmSync(join(staging, normalizeRelative(rel)), { force: true });
    for (const f of overlay.files) writeIn(staging, f.path, f.content);

    const runtime = await sources.runtime(key);
    for (const f of runtime.files) {
      if (!f.path.startsWith(RUNTIME_PREFIX)) throw new PathRejected(f.path, "runtime file outside the runtime directory");
      writeIn(staging, f.path, f.content);
    }

    // AppManifest: the project's name and VSS file; the sample app's entries go with the sample app.
    const velocitas = JSON.parse(readFileSync(join(staging, ".velocitas.json"), "utf8")) as { variables?: { appManifestPath?: string } };
    const manifestRel = normalizeRelative(velocitas.variables?.appManifestPath ?? "app/AppManifest.json");
    const manifest = JSON.parse(resetSampleEntries(readFileSync(join(staging, manifestRel), "utf8"), req.appName)) as {
      interfaces: { type: string; config: { src?: string; unit_src?: string[] } }[];
    };
    const vsi = manifest.interfaces.find((i) => i.type === "vehicle-signal-interface");
    if (!vsi) throw new InitFailed("the template AppManifest has no vehicle-signal-interface");
    const vssRel = `app/vss/vss_rel_${req.vssRelease.slice(1)}.json`;
    if (vsi.config.src !== vssRel || !existsSync(join(staging, vssRel))) {
      const old = vsi.config.src && !/^[a-z]+:\/\//.test(vsi.config.src) ? vsi.config.src : null;
      writeIn(staging, vssRel, await sources.vss(req.vssRelease));
      if (old && old !== vssRel) rmSync(join(staging, normalizeRelative(old)), { force: true });
      vsi.config.src = vssRel;
      // The model generator checks every unit against a units file — by default Velocitas' own, from VSS 4.0:
      // a release with new units (4.2: `iso8601`) needs its own file, or `velocitas init` fails in generate-model.
      const units = sources.units ? await sources.units(req.vssRelease) : null;
      if (units) {
        writeIn(staging, UNITS_REL, velocitasUnits(units));
        vsi.config.unit_src = [UNITS_REL];
      }
    }
    writeFileSync(join(staging, manifestRel), `${JSON.stringify(manifest, null, 4)}\n`);

    const meta = { slug: req.slug, appName: req.appName, language: req.language, ...(req.target === "wasm" ? { target: "wasm" } : {}), vssRelease: req.vssRelease, runtimeVersion: runtime.runtimeVersion };
    writeIn(staging, ".simvehicleapp/project.json", `${JSON.stringify(meta, null, 2)}\n`);
    writeIn(staging, ".simvehicleapp/manifest-managed.json", `${JSON.stringify({ datapoints: [], reads: [], writes: [] }, null, 2)}\n`);
    if (existsSync(target)) throw new ProjectExists(`project ${req.slug} already exists`);
    renameSync(staging, target);
    return meta;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/**
 * Keeps the project's VSS file equal to its release in vss-catalog (ADR-0052): a custom model (`vX.Y-<name>`)
 * may gain signals after the project was created, and the toolchain regenerates the vehicle model when the
 * file changes (sha256 vs the model cache). COVESA releases are pinned, so for them this is a no-op. The file
 * is the one AppManifest's vehicle-signal-interface names (written by `initProject`); a remote `src` is left alone.
 */
export async function syncProjectVss(store: Store, slug: string, sources: Pick<InitSources, "vss">): Promise<{ release: string; path: string | null; changed: boolean }> {
  const { vssRelease } = store.project(slug);
  const dir = store.projectDir(slug);
  const manifest = JSON.parse(readFileSync(join(dir, store.manifestPath(slug)), "utf8")) as { interfaces?: { type: string; config?: { src?: string } }[] };
  const src = manifest.interfaces?.find((i) => i.type === "vehicle-signal-interface")?.config?.src;
  if (!src || /^[a-z]+:\/\//.test(src)) return { release: vssRelease, path: null, changed: false };
  const rel = normalizeRelative(src);
  const abs = join(dir, rel);
  const wanted = await sources.vss(vssRelease);
  // Same document ⇒ no write: the seed's file keeps its original bytes while the catalog serves compact JSON, and a
  // rewrite would only trigger a needless vehicle-model regeneration.
  const same = (text: string) => {
    try {
      return JSON.stringify(JSON.parse(text)) === JSON.stringify(JSON.parse(wanted));
    } catch {
      return false;
    }
  };
  if (existsSync(abs) && same(readFileSync(abs, "utf8"))) return { release: vssRelease, path: rel, changed: false };
  const tmp = `${abs}.sv-sync`;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(tmp, wanted);
  renameSync(tmp, abs);
  return { release: vssRelease, path: rel, changed: true };
}

/**
 * A units file in the format of Velocitas' model generator (vss-tools 4.0: `units: {<id>: {label, description,
 * domain}}`). VSS ≥ 4.1 ships `<id>: {definition, unit, quantity, allowed-datatypes}` at the top level, which that
 * generator reads as "no units" — converted here; a file already in the old format is kept. Deterministic output
 * (ids in file order, JSON-quoted strings, which YAML reads as such).
 */
export function velocitasUnits(text: string): string {
  const doc = (Bun.YAML.parse(text) ?? {}) as Record<string, unknown>;
  if (doc.units && typeof doc.units === "object") return text;
  const q = (v: unknown) => JSON.stringify(String(v ?? ""));
  const lines = ["# Converted from the VSS release's units.yaml for Velocitas' vehicle-model generator (vss-tools 4.0 format).", "units:"];
  for (const [id, def] of Object.entries(doc)) {
    if (!def || typeof def !== "object") continue;
    const d = def as Record<string, unknown>;
    lines.push(`  ${q(id)}:`, `    label: ${q(d.unit ?? id)}`, `    description: ${q(d.definition)}`, `    domain: ${q(d.quantity)}`);
  }
  return `${lines.join("\n")}\n`;
}
