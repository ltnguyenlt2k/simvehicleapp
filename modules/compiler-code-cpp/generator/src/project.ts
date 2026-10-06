import { createHash } from "node:crypto";
import { CONTRACTS_VERSION } from "@simvehicleapp/contracts";
import { commentText, cppString, cppType, pascalCase } from "./cpp.ts";
import { BACKEND_NAME, BACKEND_VERSION, emitWorkflow, headerComment, type WorkflowIr } from "./emit.ts";
import { CodeWriter, type SourceRange } from "./writer.ts";

/**
 * A whole generation (ADR-0020 §2, analysis/07 §3): workflow files, the app host, `Main.cpp`,
 * `generated.cmake`, generated tests, source maps, the generation manifest and the AppManifest
 * fragment. Pure: the request in, a file set out, same bytes for the same request.
 */

export const RUNTIME_VERSION = "0.1.0";
export const GENERATED = "app/src/generated/";
export const TESTS = "app/tests/generated/";
export const OWNED_ROOTS = [GENERATED, TESTS];

export interface GenerateRequest {
  project: { slug: string; appName: string; language: string; mqttTopicPrefix: string; traceLevel: "off" | "trigger" | "node" };
  workflows: WorkflowIr[];
  options?: { emitTests?: boolean };
  /** Scenario v1 per workflow for the generated tests (ADR-0022 §8). */
  scenarios?: { workflowId: string; scenario: Record<string, unknown> }[];
}

export interface FileOut {
  path: string;
  content: string;
  sha256: string;
  role: "source" | "header" | "test" | "build" | "config" | "doc";
}

export interface FileSet {
  backend: string;
  runtimeVersion: string;
  files: FileOut[];
  ownedRoots: string[];
  manifestFragment: Record<string, unknown>;
  sourceMaps: { file: string; ranges: SourceRange[] }[];
  diagnostics: never[];
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const file = (path: string, content: string, role: FileOut["role"]): FileOut => ({ path, content, sha256: sha256(content), role });
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Class names: PascalCase of the workflow name; a clash gets the first 4 hex of sha256(workflowId). */
export function classNames(workflows: WorkflowIr[], appName: string): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set([appName, "AppBase", "Runtime", "Workflow"]);
  const sorted = [...workflows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.workflowId < b.workflowId ? -1 : 1));
  for (const wf of sorted) {
    let name = pascalCase(wf.name);
    if (used.has(name)) name = `${name}${sha256(wf.workflowId).slice(0, 4)}`;
    let n = 2;
    while (used.has(name)) name = `${pascalCase(wf.name)}${n++}`;
    used.add(name);
    out.set(wf.workflowId, name);
  }
  return out;
}

/** `Vehicle.Body.Lights.Hazard.IsSignaling` ⇒ `v.Body.Lights.Hazard.IsSignaling` (typed model, ADR-0022 §1). */
const modelMember = (path: string) => `v.${path.split(".").slice(1).join(".")}`;

export function generateProject(req: GenerateRequest): FileSet {
  const appName = req.project.appName;
  const workflows = [...req.workflows].sort((a, b) => (a.workflowId < b.workflowId ? -1 : 1));
  const classes = classNames(workflows, appName);
  const byName = [...workflows].sort((a, b) => (classes.get(a.workflowId)! < classes.get(b.workflowId)! ? -1 : 1));
  const files: FileOut[] = [];
  const sourceMaps: FileSet["sourceMaps"] = [];
  const irHashes = workflows.map((w) => w.irHash).join(",");
  const projectHash = `sha256:${sha256(irHashes)}`;

  for (const wf of byName) {
    const cls = classes.get(wf.workflowId)!;
    const hpp = `workflows/${cls}.hpp`;
    const out = emitWorkflow(wf, cls, hpp);
    const cpp = `${GENERATED}workflows/${cls}.cpp`;
    files.push(file(`${GENERATED}${hpp}`, out.header, "header"));
    files.push(file(cpp, out.source, "source"));
    sourceMaps.push({ file: cpp, ranges: out.ranges });
    files.push(file(`${GENERATED}sourcemap/${cls}.map.json`, json({ file: cpp, workflowId: wf.workflowId, irHash: wf.irHash, ranges: out.ranges }), "config"));
  }

  // App host: one Velocitas vehicle app running every workflow (ADR-0022 §4, ADR-0023 §5).
  const host = new CodeWriter();
  host.line(headerComment(projectHash));
  host.line("#ifndef SIMVEHICLEAPP_GENERATED_SIMVEHICLEAPP_HPP");
  host.line("#define SIMVEHICLEAPP_GENERATED_SIMVEHICLEAPP_HPP");
  host.line();
  host.line('#include "simvehicleapp/rt/Velocitas.hpp"');
  host.line();
  host.line("namespace simvehicleapp::generated {");
  host.line();
  host.line(`/** The vehicle app ${commentText(appName)}: ${byName.length} workflow(s) on the SimVehicleApp runtime. */`);
  host.block(`class ${appName} : public rt::AppBase`, () => {
    host.line("public:");
    host.line(`${appName}();`);
    host.line();
    host.line("protected:");
    host.line("void bindWorkflows(rt::Runtime& runtime) override;");
    host.line("void onAppStart() override;");
    host.line("void onAppStop() override;");
  }, "};");
  host.line();
  host.line("} // namespace simvehicleapp::generated");
  host.line();
  host.line("#endif // SIMVEHICLEAPP_GENERATED_SIMVEHICLEAPP_HPP");
  files.push(file(`${GENERATED}SimVehicleApp.hpp`, host.toString(), "header"));

  const signals = new Map<string, string>();
  for (const wf of workflows) for (const s of wf.signals) signals.set(s.path, s.dataType);
  const level = { off: "Off", trigger: "Trigger", node: "Node" }[req.project.traceLevel] ?? "Node";
  const hostCpp = new CodeWriter();
  hostCpp.line(headerComment(projectHash));
  hostCpp.line('#include "SimVehicleApp.hpp"');
  hostCpp.line();
  hostCpp.line('#include "user/UserHooks.hpp"');
  hostCpp.line('#include "vehicle/Vehicle.hpp"');
  for (const wf of byName) hostCpp.line(`#include ${cppString(`workflows/${classes.get(wf.workflowId)}.hpp`)}`);
  hostCpp.line();
  hostCpp.line("#include <type_traits>");
  hostCpp.line();
  hostCpp.line("namespace simvehicleapp::generated {");
  hostCpp.line();
  hostCpp.line("namespace {");
  hostCpp.line("/** Every signal exists with the same type in the project's vehicle model (compile-time check). */");
  hostCpp.block("[[maybe_unused]] void checkVehicleModel(vehicle::Vehicle& v)", () => {
    for (const path of [...signals.keys()].sort()) {
      const t = signals.get(path)!;
      hostCpp.call("static_assert", [`std::is_same_v<std::decay_t<decltype(${modelMember(path)})>::value_type, ${cppType(t)}>`, cppString(`${path} is ${t}`)]);
    }
    hostCpp.line("(void)v;");
  });
  hostCpp.line("} // namespace");
  hostCpp.line();
  hostCpp.line(`${appName}::${appName}()`);
  hostCpp.line(`    : AppBase(${cppString(appName)}, rt::TraceLevel::${level}) {}`);
  hostCpp.line();
  hostCpp.block(`void ${appName}::bindWorkflows(rt::Runtime& runtime)`, () => {
    for (const wf of byName) hostCpp.line(`${classes.get(wf.workflowId)}::bind(runtime);`);
  });
  hostCpp.line();
  hostCpp.line(`void ${appName}::onAppStart() { user::onAppStart(); }`);
  hostCpp.line();
  hostCpp.line(`void ${appName}::onAppStop() { user::onAppStop(); }`);
  hostCpp.line();
  hostCpp.line("} // namespace simvehicleapp::generated");
  files.push(file(`${GENERATED}SimVehicleApp.cpp`, hostCpp.toString(), "source"));

  // Main.cpp: like the template's Launcher (SIGINT/SIGTERM ⇒ stop).
  const main = new CodeWriter();
  main.line(headerComment(projectHash));
  main.line('#include "SimVehicleApp.hpp"');
  main.line('#include "sdk/Logger.h"');
  main.line();
  main.line("#include <csignal>");
  main.line("#include <memory>");
  main.line();
  main.line("namespace {");
  main.line(`std::unique_ptr<simvehicleapp::generated::${appName}> app;`);
  main.line();
  main.block("void onSignal(int sig)", () => {
    main.line('velocitas::logger().info("App terminated due to: Signal {}", sig);');
    main.line("app->stop();");
  });
  main.line("} // namespace");
  main.line();
  main.block("int main(int /*argc*/, char** /*argv*/)", () => {
    main.line("std::signal(SIGINT, onSignal);");
    main.line("std::signal(SIGTERM, onSignal);");
    main.line(`app = std::make_unique<simvehicleapp::generated::${appName}>();`);
    main.block("try", () => main.line("app->run();"), "} catch (const std::exception& e) {");
    main.lines_('    velocitas::logger().error("App terminated due to: {}", e.what());');
    main.line("} catch (...) {");
    main.lines_('    velocitas::logger().error("App terminated due to an unknown exception.");');
    main.line("}");
    main.line("return 0;");
  });
  files.push(file(`${GENERATED}Main.cpp`, main.toString(), "source"));

  const sources = byName.map((wf) => `    \${SV_GENERATED_DIR}/workflows/${classes.get(wf.workflowId)}.cpp`);
  files.push(
    file(
      `${GENERATED}generated.cmake`,
      [
        `# Generated by SimVehicleApp ${BACKEND_NAME} ${BACKEND_VERSION} — DO NOT EDIT.`,
        "set(SV_GENERATED_DIR ${CMAKE_CURRENT_LIST_DIR})",
        "set(SV_GENERATED_WORKFLOW_SOURCES",
        ...sources,
        ")",
        "set(SV_GENERATED_SOURCES",
        "    ${SV_GENERATED_DIR}/Main.cpp",
        "    ${SV_GENERATED_DIR}/SimVehicleApp.cpp",
        "    ${SV_GENERATED_WORKFLOW_SOURCES}",
        ")",
        "",
      ].join("\n"),
      "build",
    ),
  );
  // The generator lays the code out itself; `format-check` of the project leaves it alone (ADR-0022 Notes).
  files.push(file(`${GENERATED}.clang-format`, "# Generated code: laid out by SimVehicleApp, not by clang-format.\nDisableFormat: true\nSortIncludes: Never\n", "config"));

  // Generated tests: each workflow with a scenario runs it on the mock vehicle (ADR-0022 §8).
  if (req.options?.emitTests) {
    const scenarios = new Map((req.scenarios ?? []).map((s) => [s.workflowId, s.scenario]));
    const tests: string[] = [];
    for (const wf of byName) {
      const sc = scenarios.get(wf.workflowId);
      if (!sc) continue;
      const cls = classes.get(wf.workflowId)!;
      const t = new CodeWriter();
      t.line(headerComment(wf.irHash));
      t.line(`#include ${cppString(`workflows/${cls}.hpp`)}`);
      t.line();
      t.line('#include "simvehicleapp/rt/Testing.hpp"');
      t.line();
      t.line("#include <gtest/gtest.h>");
      t.line();
      t.line("namespace {");
      t.line(`/** Scenario ${commentText(String(sc.name ?? ""))} (contracts scenario v1). */`);
      t.line(`const char* const kScenario = ${rawString(JSON.stringify(sc, null, 2))};`);
      t.line("} // namespace");
      t.line();
      t.block(`TEST(${cls}Test, scenarioMeetsItsExpectations)`, () => {
        t.line("const auto scenario = simvehicleapp::rt::Value::parse(kScenario);");
        t.line(`const auto result = simvehicleapp::rt::testing::runScenario(&simvehicleapp::generated::${cls}::bind, scenario);`);
        t.line("const auto mismatches = simvehicleapp::rt::testing::checkExpectations(result, scenario.value(\"expect\", simvehicleapp::rt::Value()));");
        t.block("for (const auto& m : mismatches)", () => t.line("ADD_FAILURE() << m;"));
      });
      files.push(file(`${TESTS}${cls}_test.cpp`, t.toString(), "test"));
      tests.push(`${cls}_test.cpp`);
    }
    files.push(
      file(
        `${TESTS}CMakeLists.txt`,
        [
          `# Generated by SimVehicleApp ${BACKEND_NAME} ${BACKEND_VERSION} — DO NOT EDIT.`,
          "include(${CMAKE_CURRENT_LIST_DIR}/../../src/generated/generated.cmake)",
          ...(tests.length
            ? [
                "add_executable(app_generated_tests",
                ...tests.map((x) => `    ${x}`),
                "    ${SV_GENERATED_WORKFLOW_SOURCES}",
                ")",
                "target_include_directories(app_generated_tests PRIVATE ${SV_GENERATED_DIR})",
                "target_link_libraries(app_generated_tests simvehicleapp-runtime-testing gtest_main)",
                "include(GoogleTest)",
                "gtest_discover_tests(app_generated_tests)",
              ]
            : ["# No workflow has a scenario yet."]),
          "",
        ].join("\n"),
        "build",
      ),
    );
  }

  // Generation manifest shipped with the code: deterministic (no generationId/project, ADR-0026).
  const sorted = files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const genManifest = {
    manifestVersion: "1.0.0",
    backend: `cpp@${BACKEND_VERSION}`,
    runtimeVersion: RUNTIME_VERSION,
    contracts: CONTRACTS_VERSION,
    workflows: workflows.map((w) => ({ workflowId: w.workflowId, revision: w.workflowRevision, irHash: w.irHash })),
    ownedRoots: OWNED_ROOTS,
    files: sorted.map((f) => ({ path: f.path, sha256: f.sha256, role: f.role })),
  };
  sorted.push(file(`${GENERATED}simvehicleapp.gen.json`, json(genManifest), "config"));
  sorted.sort((a, b) => (a.path < b.path ? -1 : 1));

  return {
    backend: `cpp@${BACKEND_VERSION}`,
    runtimeVersion: RUNTIME_VERSION,
    files: sorted,
    ownedRoots: OWNED_ROOTS,
    manifestFragment: manifestFragment(workflows),
    sourceMaps: sourceMaps.sort((a, b) => (a.file < b.file ? -1 : 1)),
    diagnostics: [],
  };
}

/** AppManifest v3 fragment (ADR-0023 §4): datapoints by path (write wins over read), MQTT topics. */
export function manifestFragment(workflows: WorkflowIr[]): Record<string, unknown> {
  const access = new Map<string, "read" | "write">();
  const reads = new Set<string>();
  const writes = new Set<string>();
  for (const wf of workflows) {
    for (const s of wf.signals) {
      const w = (s as { access?: string[] }).access?.includes("write");
      access.set(s.path, w || access.get(s.path) === "write" ? "write" : "read");
    }
    for (const t of wf.topics) (t.direction === "write" ? writes : reads).add(t.topic);
  }
  return {
    "vehicle-signal-interface": {
      required: [...access.keys()].sort().map((path) => ({ path, access: access.get(path)! })),
      provided: [],
    },
    pubsub: { reads: [...reads].sort(), writes: [...writes].sort() },
  };
}

/** A C++ raw string literal for `s` (a delimiter that does not occur in it). */
export function rawString(s: string): string {
  for (let i = 0; ; i++) {
    const d = i === 0 ? "sv" : `sv${i}`;
    if (!s.includes(`)${d}"`)) return `R"${d}(${s})${d}"`;
  }
}
