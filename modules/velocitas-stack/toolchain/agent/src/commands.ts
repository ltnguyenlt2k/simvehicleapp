import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { JobKind, JobOptions, Plan, Step } from "./jobs.ts";

/**
 * What each job kind runs in a C++ project (ADR-0025 §3 + Notes M0/M6). The project is
 * `<projectsDir>/<slug>`, written by the workspace service; the agent only writes build outputs and
 * the Velocitas/Conan caches.
 */

export interface AgentConfig {
  projectsDir: string;
  /** Where the hash of the VSS file the shared vehicle model was generated from is kept (in the Conan volume). */
  modelHashFile: string;
}

export const defaultConfig = (): AgentConfig => ({
  projectsDir: process.env.SV_PROJECTS_DIR ?? "/workspace/projects",
  modelHashFile: process.env.SV_MODEL_HASH_FILE ?? join(process.env.HOME ?? "/home/vscode", ".conan2", ".sv-model-hash"),
});

/** Environment a `run` may receive (ADR-0025 §3, toolchain-job `options.env`). */
const RUN_ENV = /^(SDV_[A-Z0-9_]+|KUKSA_DATABROKER_API|SV_TRACE_LEVEL|SV_RUN_ID)$/;

export class PlanError extends Error {}

const bash = (script: string) => ["bash", "-c", script];

export function projectDir(cfg: AgentConfig, slug: string): string {
  if (!/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) throw new PlanError(`invalid project slug ${slug}`);
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
    if (!existsSync(join(dir, "build/bin/app"))) throw new PlanError("build/bin/app is missing: build the project first");
  }
}

export function createPlanner(cfg: AgentConfig = defaultConfig()) {
  return (kind: JobKind, project: string, options: JobOptions): Plan => {
    const dir = projectDir(cfg, project);
    if (!existsSync(join(dir, ".velocitas.json"))) throw new PlanError(`project ${project} does not exist or is not a Velocitas project`);
    const artifact = (rel: string) => () => (existsSync(join(dir, rel)) ? null : `${rel} was not produced (see the build log)`);
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
              check: artifact("build/bin/app"),
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
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(options.env ?? {})) {
          if (!RUN_ENV.test(k)) throw new PlanError(`environment variable ${k} is not allowed for a run`);
          env[k] = v;
        }
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
