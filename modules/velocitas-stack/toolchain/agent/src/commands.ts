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
};
const runArtifact = (cfg: AgentConfig) => RUN_ARTIFACT[cfg.toolchain ?? "cpp"] ?? RUN_ARTIFACT.cpp!;

/** Environment a `run` may receive (ADR-0025 §3, toolchain-job `options.env`). */
const RUN_ENV = /^(SDV_[A-Z0-9_]+|KUKSA_DATABROKER_API|SV_TRACE_LEVEL|SV_RUN_ID)$/;

export class PlanError extends Error {}

const bash = (script: string) => ["bash", "-c", script];

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

export function createPlanner(cfg: AgentConfig = defaultConfig()) {
  return (kind: JobKind, project: string, options: JobOptions): Plan => {
    const dir = projectDir(cfg, project);
    if (!existsSync(join(dir, ".velocitas.json"))) throw new PlanError(`project ${project} does not exist or is not a Velocitas project`);
    if ((cfg.toolchain ?? "cpp") === "python") return pythonPlan(cfg, dir, kind, options);
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
          steps: [{ label: "velocitas init", argv: bash("velocitas init"), cwd: dir, after: () => modelStep(cfg, dir, true).after?.() }],
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
      case "build":
        // ./build.sh exits 0 even when CMake configure fails (M0): the artifacts decide.
        return {
          steps: [
            modelStep(cfg, dir, false),
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
        steps: [{ label: "velocitas init", argv: bash("velocitas init"), cwd: dir, after: () => modelStep(cfg, dir, true).after?.() }],
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
