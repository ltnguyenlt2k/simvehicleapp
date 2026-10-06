/**
 * Runtime conformance P1 (ADR-0042, M06-T09/T18): every golden and conformance case of the
 * contracts fixtures is generated to C++ by this backend, compiled with the runtime and run on the
 * mock vehicle/virtual clock. It passes when
 *   - the writes are exactly `scenario.expect.writes` and the `expect.trace` matchers appear in order;
 *   - for goldens, writes and the whole trace equal `expected.writes.json` / `expected.trace.json`;
 *   - the generated gtest of each golden passes (the test a project gets from SynCode).
 *
 *   generator/conformance/conformance.sh [--only ID]     # prepare ⇒ build + run (cmake, C++17) ⇒ check
 *   bun conformance/run.ts prepare|check [--build-dir DIR] [--only ID]
 * The C++ steps run from the shell script (a confined bun cannot always start host compilers);
 * `check` exits 1 on any failure.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@simvehicleapp/contracts";
import { generate } from "../src/generate.ts";

const MODULE = fileURLToPath(new URL("../../", import.meta.url));
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const mode = process.argv[2];
if (mode !== "prepare" && mode !== "check") throw new Error("usage: run.ts prepare|check [--build-dir DIR] [--only ID]");
const buildDir = arg("--build-dir", join(MODULE, "build", "conformance"));
const only = arg("--only", "");

interface Case {
  id: string;
  dir: string;
  golden: boolean;
  scenario: Record<string, unknown> & { expect?: { writes?: unknown[]; trace?: Record<string, unknown>[] } };
  cls: string;
  /** Synthetic fuzz case: the texts that must come back. */
  fuzz?: { logs: string[]; publishes: string[] };
}

/** Driver of one case: runs the scenario on the mock vehicle and prints the result as JSON. */
function mainCpp(cls: string): string {
  return `#include "workflows/${cls}.hpp"
#include "simvehicleapp/rt/Testing.hpp"

#include <fstream>
#include <iostream>
#include <sstream>

int main(int argc, char** argv) {
    if (argc < 3) {
        return 2;
    }
    std::ifstream in(argv[1]);
    std::stringstream text;
    text << in.rdbuf();
    const auto scenario = simvehicleapp::rt::Value::parse(text.str());
    const auto r = simvehicleapp::rt::testing::runScenario(&simvehicleapp::generated::${cls}::bind, scenario, argv[2]);
    simvehicleapp::rt::Value out = simvehicleapp::rt::Value::object();
    out["trace"] = r.trace;
    out["writes"] = r.writes;
    out["publishes"] = r.publishes;
    out["logs"] = r.logs;
    std::cout << simvehicleapp::rt::stringify(out) << std::endl;
    return 0;
}
`;
}

const cases: Case[] = [];
for (const kind of ["golden", "conformance"] as const) {
  for (const id of readdirSync(join(fixturesDir, kind)).filter((d) => /^(GW-|C\d)/.test(d)).sort()) {
    if (only && id !== only) continue;
    const ir = JSON.parse(readFileSync(join(fixturesDir, kind, id, "ir.json"), "utf8"));
    const scenario = Bun.YAML.parse(readFileSync(join(fixturesDir, kind, id, "scenario.yaml"), "utf8")) as Case["scenario"];
    const r = generate({
      project: { slug: id.toLowerCase(), appName: "ConformanceApp", language: "cpp", mqttTopicPrefix: "conformance", traceLevel: "node" },
      workflows: [ir],
      options: { emitTests: kind === "golden" },
      scenarios: [{ workflowId: ir.workflowId, scenario }],
    });
    if (!r.ok) throw new Error(`${id}: generation failed ${JSON.stringify(r)}`);
    const dir = join(buildDir, "cases", id);
    let cls = "";
    for (const f of r.fileSet.files) {
      const m = /^app\/src\/generated\/(workflows\/(\w+)\.(?:hpp|cpp))$/.exec(f.path);
      const t = /^app\/tests\/generated\/(\w+_test\.cpp)$/.exec(f.path);
      if (m) {
        if (m[1]!.endsWith(".cpp")) cls = m[2]!;
        mkdirSync(join(dir, "workflows"), { recursive: true });
        writeFileSync(join(dir, m[1]!), f.content);
      } else if (t) writeFileSync(join(dir, t[1]!), f.content);
    }
    writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
    writeFileSync(join(dir, "main.cpp"), mainCpp(cls));
    cases.push({ id, dir, golden: kind === "golden", scenario, cls });
  }
}

// Synthetic case (ADR-0022 Verification "fuzz names/strings never break compile"): user text in every
// place the contract lets it reach C++ — templates, string constants, topics (workflow and variable
// names are identifiers by contract) — must compile and come back byte for byte.
const FUZZ = [
  'say "hi"\n\t\\', "*/ /* // \\", "??=??/??'", "\u0000\u0001\u001f\u007f\u0085", "Ünïcode ✓ ữ 車 🚗",
  "R\"sv(raw)sv\"", "%s %d {} {0}", "\u2028\u2029 line seps", "#include <x>", "\\", "\"", "",
];
if (!only || only === "FUZZ-strings") {
  const id = "FUZZ-strings";
  const src = (b: string) => ({ blockId: b });
  const nodes = FUZZ.map((text, i) => ({
    id: `n${i + 2}`,
    opcode: i % 2 ? "comm.mqtt_publish" : "comm.log",
    args: i % 2 ? { topic: "t0", payload: { $template: [{ $const: text, type: "string" }] }, payloadType: "text", qos: 0, retain: false } : { level: "info", message: { $template: [text, { $state: "v0" }] } },
    next: { next: i + 1 < FUZZ.length ? `n${i + 3}` : null },
    src: src(`b${i + 2}`),
  }));
  const ir = {
    irVersion: "1.0.0", compilerVersion: "0.1.0", workflowId: "fuzz_strings", workflowRevision: 1, name: "FuzzStrings",
    modelHash: `sha256:${"0".repeat(64)}`, sourceGraphHash: `sha256:${"0".repeat(64)}`, irHash: `sha256:${"1".repeat(64)}`,
    signals: [], topics: [{ id: "t0", topic: "fuzz/*/??/\"x\"", direction: "write" }],
    state: [{ id: "v0", name: "fuzz_state", type: "string", initial: FUZZ[1]! }],
    triggers: [{ id: "n1", opcode: "event.app_start", props: {}, outputs: {}, entry: "n2", src: src("b1") }],
    nodes, diagnostics: [],
  };
  const r = generate({ project: { slug: "fuzz", appName: "FuzzApp", language: "cpp", mqttTopicPrefix: "fuzz", traceLevel: "node" }, workflows: [ir] });
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r)}`);
  const dir = join(buildDir, "cases", id);
  let cls = "";
  for (const f of r.fileSet.files) {
    const m = /^app\/src\/generated\/(workflows\/(\w+)\.(?:hpp|cpp))$/.exec(f.path);
    if (!m) continue;
    if (m[1]!.endsWith(".cpp")) cls = m[2]!;
    mkdirSync(join(dir, "workflows"), { recursive: true });
    writeFileSync(join(dir, m[1]!), f.content);
  }
  const expectLogs = FUZZ.flatMap((t, i) => (i % 2 ? [] : [t]));
  const expectPublishes = FUZZ.flatMap((t, i) => (i % 2 ? [t] : []));
  writeFileSync(join(dir, "scenario.json"), JSON.stringify({ scenarioVersion: "1.0.0", name: id, until: 10, inputs: [] }));
  writeFileSync(join(dir, "main.cpp"), mainCpp(cls));
  cases.push({ id, dir, golden: false, cls, scenario: { scenarioVersion: "1.0.0", name: id, until: 10, inputs: [] }, fuzz: { logs: expectLogs, publishes: expectPublishes } } as Case);
}

const target = (c: Case) => `case_${c.id.replace(/[^A-Za-z0-9]/g, "_")}`;
const cmake = [
  "cmake_minimum_required(VERSION 3.16)",
  "project(simvehicleapp-conformance CXX)",
  "set(CMAKE_CXX_STANDARD 17)",
  "set(SV_RT_TESTS OFF CACHE BOOL \"\" FORCE)",
  `add_subdirectory(${JSON.stringify(join(MODULE, "runtime"))} runtime)`,
  "include(FetchContent)",
  "if(DEFINED ENV{SV_GOOGLETEST_SRC})",
  "  FetchContent_Declare(googletest SOURCE_DIR $ENV{SV_GOOGLETEST_SRC})",
  "else()",
  "  FetchContent_Declare(googletest URL https://github.com/google/googletest/archive/609281088cfefc76f9d0ce82e1ff6c30cc3591e5.zip",
  "    URL_HASH SHA256=5cf189eb6847b4f8fc603a3ffff3b0771c08eec7dd4bd961bfd45477dd13eb73)",
  "endif()",
  "set(INSTALL_GTEST OFF CACHE BOOL \"\" FORCE)",
  "FetchContent_MakeAvailable(googletest)",
  ...cases.flatMap((c) => [
    `add_executable(${target(c)} cases/${c.id}/main.cpp cases/${c.id}/workflows/${c.cls}.cpp)`,
    `target_include_directories(${target(c)} PRIVATE cases/${c.id})`,
    `target_link_libraries(${target(c)} PRIVATE simvehicleapp-runtime-testing)`,
    `target_compile_options(${target(c)} PRIVATE -Wall -Wextra -Werror)`,
    ...(c.golden
      ? [
          `add_executable(gtest_${target(c)} cases/${c.id}/${c.cls}_test.cpp cases/${c.id}/workflows/${c.cls}.cpp)`,
          `target_include_directories(gtest_${target(c)} PRIVATE cases/${c.id})`,
          `target_link_libraries(gtest_${target(c)} PRIVATE simvehicleapp-runtime-testing gtest_main)`,
        ]
      : []),
  ]),
  "",
].join("\n");
if (mode === "prepare") {
  writeFileSync(join(buildDir, "CMakeLists.txt"), cmake);
  writeFileSync(join(buildDir, "cases.json"), JSON.stringify(cases.map((c) => ({ id: c.id, target: target(c), golden: c.golden, scenario: join(c.dir, "scenario.json"), runId: c.golden ? "golden" : "sim" })), null, 2));
  console.log(`conformance: prepared ${cases.length} cases in ${buildDir}`);
  process.exit(0);
}

const stringify = (v: unknown) => JSON.stringify(v);
const same = (a: unknown, b: unknown) => stringify(a) === stringify(b);
function subset(want: unknown, have: unknown): boolean {
  if (want && typeof want === "object" && !Array.isArray(want)) {
    if (!have || typeof have !== "object") return false;
    return Object.entries(want).every(([k, v]) => subset(v, (have as Record<string, unknown>)[k]));
  }
  return same(want, have);
}

let failed = 0;
for (const c of cases) {
  const problems: string[] = [];
  const result = join(buildDir, "results", `${c.id}.json`);
  if (!existsSync(result)) {
    failed++;
    console.log(`FAIL ${c.id}\n  no result (the case did not build or run)`);
    continue;
  }
  const out = JSON.parse(readFileSync(result, "utf8"));
  const exp = c.scenario.expect;
  if (exp?.writes) {
    const have = out.writes.map((w: { t: number; path: string; value: unknown }) => ({ t: w.t, path: w.path, value: w.value }));
    if (!same(have, exp.writes)) problems.push(`writes differ: expected ${stringify(exp.writes)} actual ${stringify(have)}`);
  }
  if (exp?.trace) {
    let i = 0;
    for (const m of exp.trace) {
      while (i < out.trace.length && !subset(m, out.trace[i])) i++;
      if (i === out.trace.length) {
        problems.push(`trace event ${stringify(m)} not found (in order)`);
        break;
      }
      i++;
    }
  }
  if (c.fuzz) {
    const logs = out.logs.map((l: { message: string }) => l.message);
    const pubs = out.publishes.map((p: { payload: string }) => p.payload);
    const want = c.fuzz.logs.map((t) => `${t}*/ /* // \\`);
    if (!same(logs, want)) problems.push(`log texts changed: ${stringify(logs)} ≠ ${stringify(want)}`);
    if (!same(pubs, c.fuzz.publishes)) problems.push(`publish payloads changed: ${stringify(pubs)} ≠ ${stringify(c.fuzz.publishes)}`);
  }
  if (c.golden) {
    const wantTrace = JSON.parse(readFileSync(join(fixturesDir, "golden", c.id, "expected.trace.json"), "utf8"));
    const wantWrites = JSON.parse(readFileSync(join(fixturesDir, "golden", c.id, "expected.writes.json"), "utf8"));
    if (!same(out.writes, wantWrites)) problems.push("writes ≠ expected.writes.json");
    if (!same(out.trace, wantTrace)) {
      const k = wantTrace.findIndex((e: unknown, i: number) => !same(e, out.trace[i]));
      problems.push(`trace ≠ expected.trace.json at event ${k}: expected ${stringify(wantTrace[k])} actual ${stringify(out.trace[k])}`);
    }
    const gtest = join(buildDir, "results", `${c.id}.gtest`);
    const status = existsSync(gtest) ? readFileSync(gtest, "utf8").trim() : "missing";
    if (status !== "0") problems.push(`generated gtest failed (exit ${status}, log results/${c.id}.gtest.log)`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"} ${c.id}${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
}
console.log(`conformance (C++ runtime + generated code): ${cases.length - failed}/${cases.length} PASS`);
process.exit(failed ? 1 : 0);
