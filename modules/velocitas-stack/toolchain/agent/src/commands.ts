import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JobKind, JobOptions, Plan, Step } from "./jobs.ts";

/**
 * What each job kind runs in a project of this toolchain's language (ADR-0025 §3 + Notes M0/M6; Python:
 * ADR-0040 §4). The project is `<projectsDir>/<slug>`, written by the workspace service; the agent only
 * writes build outputs and the Velocitas/Conan/pip caches.
 */

export interface AgentConfig {
  projectsDir: string;
  /** Where the hash of the VSS file the shared vehicle model was generated from is kept (in the Conan volume). */
  modelHashFile: string;
  /** Language of the projects this toolchain builds (`SV_TOOLCHAIN`, default cpp). */
  toolchain?: string;
}

export const defaultConfig = (): AgentConfig => ({
  projectsDir: process.env.SV_PROJECTS_DIR ?? "/workspace/projects",
  modelHashFile: process.env.SV_MODEL_HASH_FILE ?? join(process.env.HOME ?? "/home/vscode", ".conan2", ".sv-model-hash"),
  toolchain: process.env.SV_TOOLCHAIN ?? "cpp",
});

/** What a run executes and must find first (C++: the built binary; Python: the generated app). */
const RUN_ARTIFACT: Record<string, { file: string; missing: string }> = {
  cpp: { file: "build/bin/app", missing: "build/bin/app is missing: build the project first" },
  python: { file: "app/src/generated/app.py", missing: "app/src/generated/app.py is missing: SynCode the project first" },
  rust: { file: "build/bin/app", missing: "build/bin/app is missing: build the project first" },
  wasm: { file: "build/app.cwasm", missing: "build/app.cwasm is missing: build the project first" },
};
const runArtifact = (cfg: AgentConfig) => RUN_ARTIFACT[cfg.toolchain ?? "cpp"] ?? RUN_ARTIFACT.cpp!;

/** Environment a `run` may receive (ADR-0025 §3, toolchain-job `options.env`). */
const RUN_ENV = /^(SDV_[A-Z0-9_]+|KUKSA_DATABROKER_API|SV_DATABROKER_API|SV_TRACE_LEVEL|SV_RUN_ID)$/;

export class PlanError extends Error {}

const bash = (script: string) => ["bash", "-c", script];

/**
 * Velocitas keeps one Python venv per project in `~/.velocitas/projects/md5(<project path>)/pyvenv` (C++ ~200 MB,
 * Python ~150 MB) although every project pins the seed's packages: before `velocitas init`, link it to the seed
 * project's venv baked into the image, so a project costs a few MB (ADR-0051; init/build/tests verified with the
 * link, the seed venv is not written). A project that already has its own venv keeps it.
 */
export const SHARE_SEED_VENV =
  'seed="$HOME/.velocitas/projects/$(printf %s "${SV_SEED_DIR:-}" | md5sum | cut -c1-32)/pyvenv"; ' +
  'own="$HOME/.velocitas/projects/$(pwd -P | tr -d \'\\n\' | md5sum | cut -c1-32)"; ' +
  'if [ -n "${SV_SEED_DIR:-}" ] && [ -d "$seed" ] && [ ! -e "$own/pyvenv" ]; then mkdir -p "$own" && ln -s "$seed" "$own/pyvenv"; fi';

export function projectDir(cfg: AgentConfig, slug: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new PlanError(`invalid project slug ${slug}`); // contracts common `slug`
  const dir = resolve(cfg.projectsDir, slug);
  if (dirname(dir) !== resolve(cfg.projectsDir)) throw new PlanError("project outside the projects directory");
  return dir;
}

/** The VSS file of the project (AppManifest `vehicle-signal-interface` src, path from `.velocitas.json`). */
export function vssFile(dir: string): string | null {
  try {
    const velocitas = JSON.parse(readFileSync(join(dir, ".velocitas.json"), "utf8")) as { variables?: { appManifestPath?: string } };
    const manifestPath = join(dir, velocitas.variables?.appManifestPath ?? "app/AppManifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { interfaces?: { type: string; config?: { src?: string } }[] };
    const src = manifest.interfaces?.find((i) => i.type === "vehicle-signal-interface")?.config?.src;
    if (!src || /^[a-z]+:\/\//.test(src)) return null;
    const file = resolve(dir, src);
    return file.startsWith(`${dir}/`) && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** `generate-model` step that runs only when the project's VSS differs from the one in the shared cache (M07-T05). */
function modelStep(cfg: AgentConfig, dir: string, force: boolean): Step {
  const current = () => {
    const f = vssFile(dir);
    return f ? sha256(f) : null;
  };
  const stored = () => (existsSync(cfg.modelHashFile) ? readFileSync(cfg.modelHashFile, "utf8").trim() : "");
  return {
    label: "velocitas exec vehicle-signal-interface generate-model",
    argv: bash("velocitas exec vehicle-signal-interface generate-model"),
    cwd: dir,
    when: () => force || (current() !== null && current() !== stored()),
    after: () => {
      const h = current();
      if (h) {
        mkdirSync(dirname(cfg.modelHashFile), { recursive: true });
        writeFileSync(cfg.modelHashFile, `${h}\n`);
      }
    },
  };
}

/** Synchronous checks of a job request (422 before it is queued). */
export function validateJob(cfg: AgentConfig, kind: JobKind, project: string, options: JobOptions): void {
  const dir = projectDir(cfg, project);
  if (!existsSync(join(dir, ".velocitas.json"))) throw new PlanError(`project ${project} does not exist or is not a Velocitas project`);
  if (kind === "run") {
    for (const k of Object.keys(options.env ?? {})) if (!RUN_ENV.test(k)) throw new PlanError(`environment variable ${k} is not allowed for a run`);
    const art = runArtifact(cfg);
    if (!existsSync(join(dir, art.file))) throw new PlanError(art.missing);
  }
}

/** Validated `run` environment (SDV_*, SV_TRACE_LEVEL, …). */
function runEnv(options: JobOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(options.env ?? {})) {
    if (!RUN_ENV.test(k)) throw new PlanError(`environment variable ${k} is not allowed for a run`);
    env[k] = v;
  }
  return env;
}

/**
 * `image` (ADR-0060, M18-T10): the app's OCI image pushed to a registry without Docker — `image-cli.ts` (run by this
 * agent's own bun) packs build/bin/app with its shared libraries, the AppManifest and the notices.
 */
function imageStep(dir: string, options: JobOptions): Step {
  const img = options.image;
  if (!img?.reference) throw new PlanError("image: a registry reference is required");
  return {
    label: `image ${img.reference}`,
    argv: [process.execPath, join(import.meta.dir, "image-cli.ts"), "--binary", join(dir, "build/bin/app"), "--project", dir, "--reference", img.reference, ...(img.insecure ? ["--insecure"] : [])],
    cwd: dir,
    ...(img.username ? { env: { SV_IMAGE_USERNAME: img.username, SV_IMAGE_PASSWORD: img.password ?? "" } } : {}),
    check: (lines) => (lines.some((l) => l.startsWith("SVIMAGE ")) ? null : "the image was not pushed (see the log)"),
  };
}

export function createPlanner(cfg: AgentConfig = defaultConfig()) {
  return (kind: JobKind, project: string, options: JobOptions): Plan => {
    const dir = projectDir(cfg, project);
    if (!existsSync(join(dir, ".velocitas.json"))) throw new PlanError(`project ${project} does not exist or is not a Velocitas project`);
    if (kind === "image" && cfg.toolchain !== "wasm") {
      const lang = cfg.toolchain ?? "cpp";
      if (lang === "python") throw new PlanError("image: Python apps need PyInstaller and staticx to be packed (template Dockerfile); not available in this toolchain yet");
      const steps: Step[] =
        lang === "cpp"
          ? [{ label: "./build.sh -r (Release for the image)", argv: bash("./build.sh -r"), cwd: dir, check: (lines) => lines.find((l) => /^FAILED: |^ninja: build stopped|^CMake Error/.test(l)) ?? null }]
          : [];
      return { steps: [...steps, imageStep(dir, options)], failCode: "BUILD_FAILED", failStage: "build" };
    }
    if (cfg.toolchain === "wasm") return wasmPlan(dir, kind, options);
    if ((cfg.toolchain ?? "cpp") === "python") return pythonPlan(cfg, dir, kind, options);
    if (cfg.toolchain === "rust") return rustPlan(dir, kind, options);
    const artifact = (rel: string) => () => (existsSync(join(dir, rel)) ? null : `${rel} was not produced (see the build log)`);
    // build.sh exits 0 whatever happens and a failed build leaves the previous binary in place: the
    // build's own output decides (ninja/CMake failure lines), then the artifact must exist.
    const built = (rel: string) => (lines: readonly string[]) => {
      const failure = lines.find((l) => /^FAILED: |^ninja: build stopped|Configuring incomplete, errors occurred|^CMake Error/.test(l));
      return failure ? `the build failed: ${failure}` : artifact(rel)();
    };
    switch (kind) {
      case "init":
        // `velocitas init` runs the component hooks (download-vspec, generate-model, SDK, Conan) offline.
        return {
          steps: [{ label: "velocitas init", argv: bash(`${SHARE_SEED_VENV}; velocitas init`), cwd: dir, after: () => modelStep(cfg, dir, true).after?.() }],
          failCode: "BUILD_FAILED",
          failStage: "build",
        };
      case "generate-model":
        return { steps: [modelStep(cfg, dir, true)], failCode: "BUILD_FAILED", failStage: "build" };
      case "deps":
        return {
          steps: [modelStep(cfg, dir, false), { label: "./install_dependencies.sh", argv: bash("./install_dependencies.sh"), cwd: dir }],
          failCode: "DEPS_INSTALL_FAILED",
          failStage: "build",
        };
      case "build": {
        // generate-model exports a new `vehicle-model` Conan revision; the project's CMake files still name the old
        // package until `conan install` runs again — needed when the project's VSS file changed (a custom model that
        // gained signals, ADR-0052) or another release's model was in the shared cache.
        const model = modelStep(cfg, dir, false);
        let regenerated = false;
        // ./build.sh exits 0 even when CMake configure fails (M0): the artifacts decide.
        return {
          steps: [
            { ...model, after: () => ((regenerated = true), model.after?.()) },
            { label: "./install_dependencies.sh (vehicle model regenerated)", argv: bash("./install_dependencies.sh"), cwd: dir, when: () => regenerated },
            {
              label: options.release ? "./build.sh -r" : "./build.sh",
              argv: bash(options.release ? "./build.sh -r" : "./build.sh"),
              cwd: dir,
              check: built("build/bin/app"),
            },
          ],
          failCode: "BUILD_FAILED",
          failStage: "build",
        };
      }
      case "test": {
        // ctest finds no test (template enables testing after add_subdirectory): run the gtest binaries.
        const run = (bin: string) => `if [ -x build/bin/${bin} ]; then build/bin/${bin} --gtest_output=xml:build/test-results/${bin}.xml; else echo "no ${bin}"; fi`;
        return {
          steps: [
            { label: "build/bin/app_generated_tests", argv: bash(`mkdir -p build/test-results && ${run("app_generated_tests")}`), cwd: dir },
            { label: "build/bin/app_utests", argv: bash(run("app_utests")), cwd: dir },
          ],
          failCode: "GENERATED_TEST_FAILED",
          failStage: "test",
        };
      }
      case "format-check":
        return {
          steps: [
            {
              label: "clang-format --dry-run --Werror app/src/generated",
              argv: bash("find app/src/generated -type f \\( -name '*.cpp' -o -name '*.hpp' \\) -print0 | xargs -0 -r clang-format --dry-run --Werror"),
              cwd: dir,
            },
          ],
          failCode: "BUILD_FAILED",
          failStage: "build",
        };
      case "run": {
        const env = runEnv(options);
        if (!existsSync(join(dir, "build/bin/app"))) throw new PlanError("build/bin/app is missing: build the project first");
        return {
          steps: [{ label: "build/bin/app", argv: ["build/bin/app"], cwd: dir, env }],
          failCode: "RUN_CRASHED",
          failStage: "run",
        };
      }
      default:
        throw new PlanError(`job kind ${kind} has no plan`);
    }
  };
}

/** The vendored runtime of a Python project (ADR-0040; same vendor path as C++, ADR-0021 §8). */
const PY_RUNTIME = "app/src/simvehicleapp-runtime";
const GENERATED_PY = "app/src/generated app/tests/generated";
/** Where Python writes byte-code (outside every project). */
const PY_CACHE = "/tmp/sv-pycache";

/**
 * Python projects (ADR-0040 §4): pip installs the template's pinned requirements from the image's
 * wheelhouse, "build" byte-compiles the app and checks the generated app against the project's VSS (the
 * C++ static_assert on the vehicle model), tests are the generated pytest files — reported as gtest lines
 * so the orchestrator maps a failure to its workflow — and format-check is `ruff format --check` +
 * `ruff check` of the generated code (laid out like ruff format by the generator).
 */
function pythonPlan(cfg: AgentConfig, dir: string, kind: JobKind, options: JobOptions): Plan {
  // Byte-code caches never land in the project: `app/src/generated` is SynCode-owned, and a `__pycache__`
  // there makes the next SynCode report GENERATED_FILE_MODIFIED (M12 parity run, 2026-10-07).
  const env = { PYTHONPATH: `${dir}/app/src:${dir}/${PY_RUNTIME}`, PYTHONPYCACHEPREFIX: PY_CACHE };
  switch (kind) {
    case "init":
      return {
        steps: [{ label: "velocitas init", argv: bash(`${SHARE_SEED_VENV}; velocitas init`), cwd: dir, after: () => modelStep(cfg, dir, true).after?.() }],
        failCode: "BUILD_FAILED",
        failStage: "build",
      };
    case "generate-model":
      return { steps: [modelStep(cfg, dir, true)], failCode: "BUILD_FAILED", failStage: "build" };
    case "deps":
      return {
        steps: [
          modelStep(cfg, dir, false),
          {
            label: "pip3 install -r app/requirements.txt -r app/tests/requirements.txt",
            argv: bash("pip3 install --disable-pip-version-check -q -r app/requirements.txt -r app/tests/requirements.txt"),
            cwd: dir,
          },
        ],
        failCode: "DEPS_INSTALL_FAILED",
        failStage: "build",
      };
    case "build":
      return {
        steps: [
          modelStep(cfg, dir, false),
          { label: "python3 -m compileall app/src", argv: ["python3", "-m", "compileall", "-q", "app/src"], cwd: dir, env },
          { label: "python3 -m simvehicleapp_runtime.check_project", argv: ["python3", "-m", "simvehicleapp_runtime.check_project", "."], cwd: dir, env },
        ],
        failCode: "BUILD_FAILED",
        failStage: "build",
      };
    case "test":
      // Exit 5 = no test collected (no workflow has a scenario yet): nothing ran, which is not a failure.
      return {
        steps: [
          {
            label: "pytest app/tests/generated",
            argv: bash(`if [ -d app/tests/generated ]; then python3 -m pytest -q -p no:cacheprovider -p simvehicleapp_runtime.pytest_gtest app/tests/generated; rc=$?; [ $rc -eq 5 ] && exit 0; exit $rc; else echo "no app/tests/generated"; fi`),
            cwd: dir,
            env,
          },
        ],
        failCode: "GENERATED_TEST_FAILED",
        failStage: "test",
      };
    case "format-check":
      return {
        steps: [
          { label: `ruff format --check ${GENERATED_PY}`, argv: bash(`ruff format --no-cache --check ${GENERATED_PY}`), cwd: dir },
          { label: `ruff check ${GENERATED_PY}`, argv: bash(`ruff check --no-cache ${GENERATED_PY}`), cwd: dir },
        ],
        failCode: "BUILD_FAILED",
        failStage: "build",
      };
    case "run": {
      const runEnvVars = runEnv(options);
      if (!existsSync(join(dir, RUN_ARTIFACT.python!.file))) throw new PlanError(RUN_ARTIFACT.python!.missing);
      return {
        steps: [{ label: "python3 app/src/main.py", argv: ["python3", "-u", "app/src/main.py"], cwd: dir, env: { ...runEnvVars, PYTHONPYCACHEPREFIX: PY_CACHE } }],
        failCode: "RUN_CRASHED",
        failStage: "run",
      };
    }
    default:
      throw new PlanError(`job kind ${kind} has no plan`);
  }
}

/** Language of a WebAssembly project (`.velocitas.json` variables `target: wasm`, `language`, ADR-0061). */
function wasmLanguage(dir: string): "cpp" | "rust" {
  const v = (JSON.parse(readFileSync(join(dir, ".velocitas.json"), "utf8")) as { variables?: { language?: string; target?: string } }).variables ?? {};
  if (v.target !== "wasm") throw new PlanError("not a WebAssembly project (.velocitas.json variables.target is not wasm)");
  if (v.language !== "cpp" && v.language !== "rust") throw new PlanError(`no WebAssembly toolchain for ${v.language ?? "an unknown language"}`);
  return v.language;
}

/** After the language's build: validate and strip `build/app.wasm`, then precompile it with this host (ABI §5). */
const WASM_FINISH = "wasm-tools validate build/app.wasm && wasm-tools strip build/app.wasm -o build/app.wasm && sv-wasm-host --precompile build/app.wasm build/app.cwasm";

/**
 * WebAssembly projects (ADR-0061, M20-T06): C++ with wasi-sdk through CMake, Rust with cargo for wasm32-wasip1
 * (offline, vendored sources, shared target dir); both end in `build/app.wasm` + `build/app.cwasm`. Tests are the
 * generated cases run inside the guest by `sv-wasm-host --test` (exit code = failed cases); a run is the host on
 * the precompiled module with the app's allowlist.
 */
function wasmPlan(dir: string, kind: JobKind, options: JobOptions): Plan {
  const lang = wasmLanguage(dir);
  const jobs = "-j ${SV_CARGO_JOBS:-2}";
  const build =
    lang === "cpp"
      ? 'cmake -S app -B build/cmake -DCMAKE_TOOLCHAIN_FILE="$WASI_SDK_PATH/share/cmake/wasi-sdk-p1.cmake" -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build build/cmake && mkdir -p build && cp build/cmake/app.wasm build/app.wasm'
      : `cargo build --manifest-path app/Cargo.toml --release --offline --target wasm32-wasip1 ${jobs} --message-format short && mkdir -p build && cp "$CARGO_TARGET_DIR/wasm32-wasip1/release/app.wasm" build/app.wasm`;
  switch (kind) {
    case "init":
      return { steps: [{ label: `WebAssembly ${lang} project`, argv: bash(lang === "cpp" ? "test -f app/CMakeLists.txt" : "cargo metadata --manifest-path app/Cargo.toml --offline --format-version 1 --no-deps > /dev/null"), cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "generate-model":
    case "deps":
      return { steps: [{ label: "nothing to prepare (signals by VSS path, dependencies in the image)", argv: ["true"], cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "build":
      return {
        steps: [{ label: lang === "cpp" ? "cmake (wasi-sdk) ⇒ app.wasm ⇒ app.cwasm" : "cargo build (wasm32-wasip1) ⇒ app.wasm ⇒ app.cwasm", argv: bash(`${build} && ${WASM_FINISH}`), cwd: dir, check: () => (existsSync(join(dir, "build/app.cwasm")) ? null : "build/app.cwasm was not produced (see the build log)") }],
        failCode: "BUILD_FAILED",
        failStage: "build",
      };
    case "test": {
      if (!existsSync(join(dir, "build/app.cwasm"))) throw new PlanError("build/app.cwasm is missing: build the project first");
      const cases = existsSync(join(dir, "app/tests/generated/cases.json")) ? "app/tests/generated/cases.json" : null;
      return {
        steps: [{ label: "sv-wasm-host --test", argv: cases ? ["sv-wasm-host", "--test", "build/app.cwasm", cases] : bash("echo 'no test cases yet'"), cwd: dir }],
        failCode: "GENERATED_TEST_FAILED",
        failStage: "test",
      };
    }
    case "format-check":
      return { steps: [{ label: lang === "rust" ? "cargo fmt --check" : "no formatter for generated C++ (laid out by SimVehicleApp)", argv: lang === "rust" ? bash("cargo fmt --manifest-path app/Cargo.toml --check") : ["true"], cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "run": {
      const env = runEnv(options);
      if (!existsSync(join(dir, "build/app.cwasm"))) throw new PlanError("build/app.cwasm is missing: build the project first");
      return { steps: [{ label: "sv-wasm-host build/app.cwasm", argv: ["sv-wasm-host", "build/app.cwasm", "app/src/generated/sv-app.json"], cwd: dir, env }], failCode: "RUN_CRASHED", failStage: "run" };
    }
    default:
      throw new PlanError(`job kind ${kind} has no plan for a WebAssembly project yet`);
  }
}

/**
 * Rust projects (ADR-0041, feasibility — no Velocitas CLI): cargo offline on the image's vendored sources and a
 * shared warm target dir (`CARGO_TARGET_DIR`), so "build" copies the app binary into the project's `build/bin/app`
 * (projects never share a binary). Tests are the generated test target (its harness prints gtest lines),
 * format-check is `cargo fmt --check`.
 */
function rustPlan(dir: string, kind: JobKind, options: JobOptions): Plan {
  const jobs = "-j ${SV_CARGO_JOBS:-2}";
  switch (kind) {
    case "init":
      return { steps: [{ label: "cargo metadata --offline", argv: bash("cargo metadata --offline --format-version 1 --no-deps > /dev/null"), cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "generate-model":
      return { steps: [{ label: "no vehicle model (Rust: signals by VSS path)", argv: ["true"], cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "deps":
      return { steps: [{ label: "cargo fetch --offline", argv: bash("cargo fetch --offline"), cwd: dir }], failCode: "DEPS_INSTALL_FAILED", failStage: "build" };
    case "build":
      return {
        steps: [
          {
            label: "cargo build --release",
            argv: bash(`cargo build --release --offline ${jobs} --message-format short && mkdir -p build/bin && cp "$CARGO_TARGET_DIR/release/app" build/bin/app`),
            cwd: dir,
          },
          { label: "sv-check-signals", argv: ["sv-check-signals", "."], cwd: dir },
        ],
        failCode: "BUILD_FAILED",
        failStage: "build",
      };
    case "test":
      return { steps: [{ label: "cargo test --test generated", argv: bash(`cargo test --release --offline ${jobs} --test generated`), cwd: dir }], failCode: "GENERATED_TEST_FAILED", failStage: "test" };
    case "format-check":
      return { steps: [{ label: "cargo fmt --check", argv: bash("cargo fmt --check"), cwd: dir }], failCode: "BUILD_FAILED", failStage: "build" };
    case "run": {
      const env = runEnv(options);
      if (!existsSync(join(dir, "build/bin/app"))) throw new PlanError(RUN_ARTIFACT.rust!.missing);
      return { steps: [{ label: "build/bin/app", argv: ["build/bin/app"], cwd: dir, env }], failCode: "RUN_CRASHED", failStage: "run" };
    }
    default:
      throw new PlanError(`job kind ${kind} has no plan`);
  }
}
