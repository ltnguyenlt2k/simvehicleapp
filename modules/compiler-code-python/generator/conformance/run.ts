/**
 * Runtime conformance P1 of the Python backend (ADR-0042, M12-T03/T04): every golden and conformance case
 * of the contracts fixtures is generated to Python by this backend and run with the runtime on the mock
 * vehicle/virtual clock. It passes when
 *   - the writes are exactly `scenario.expect.writes` and the `expect.trace` matchers appear in order;
 *   - for goldens, writes and the whole trace equal `expected.writes.json` / `expected.trace.json`;
 *   - the generated pytest of each golden passes (the test a project gets from SynCode).
 *
 *   generator/conformance/conformance.sh [--only ID]     # prepare ⇒ run (python3, pytest) ⇒ check
 *   bun conformance/run.ts prepare|check [--build-dir DIR] [--only ID]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  module: string;
  /** Synthetic fuzz case: the texts that must come back. */
  fuzz?: { logs: string[]; publishes: string[] };
}

/** Driver of one case: runs the scenario on the mock vehicle and prints the result as JSON. */
const DRIVER = `import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app", "src"))
sys.path.insert(0, ${JSON.stringify(join(MODULE, "runtime"))})
import importlib
from simvehicleapp_runtime import values as V
from simvehicleapp_runtime.testing import run_scenario
mod = importlib.import_module("generated.workflows." + sys.argv[3])
scenario = json.load(open(sys.argv[1]))
r = run_scenario(mod.bind, scenario, sys.argv[2])
print(V.js_json({"trace": r["trace"], "writes": r["writes"], "publishes": r["publishes"], "logs": r["logs"]}))
`;

function writeFiles(dir: string, files: { path: string; content: string }[]): string {
  let mod = "";
  for (const f of files) {
    const m = /^app\/src\/generated\/workflows\/(\w+)\.py$/.exec(f.path);
    if (m && m[1] !== "__init__") mod = m[1]!;
    if (!/^app\/(src|tests)\/generated\//.test(f.path)) continue;
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  writeFileSync(join(dir, "driver.py"), DRIVER);
  return mod;
}

const cases: Case[] = [];
if (mode === "prepare") rmSync(join(buildDir, "cases"), { recursive: true, force: true });
for (const kind of ["golden", "conformance"] as const) {
  for (const id of readdirSync(join(fixturesDir, kind)).filter((d) => /^(GW-|C\d)/.test(d)).sort()) {
    if (only && id !== only) continue;
    const ir = JSON.parse(readFileSync(join(fixturesDir, kind, id, "ir.json"), "utf8"));
    const scenario = Bun.YAML.parse(readFileSync(join(fixturesDir, kind, id, "scenario.yaml"), "utf8")) as Case["scenario"];
    const r = generate({
      project: { slug: id.toLowerCase(), appName: "ConformanceApp", language: "python", mqttTopicPrefix: "conformance", traceLevel: "node" },
      workflows: [ir],
      options: { emitTests: kind === "golden" },
      scenarios: [{ workflowId: ir.workflowId, scenario }],
    });
    if (!r.ok) throw new Error(`${id}: generation failed ${JSON.stringify(r)}`);
    const dir = join(buildDir, "cases", id);
    const module = mode === "prepare" ? writeFiles(dir, r.fileSet.files) : r.fileSet.files.map((f) => /^app\/src\/generated\/workflows\/(\w+)\.py$/.exec(f.path)?.[1]).find((m) => m && m !== "__init__")!;
    if (mode === "prepare") writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
    cases.push({ id, dir, golden: kind === "golden", scenario, module });
  }
}

// Synthetic case (ADR-0022 Verification "fuzz names/strings never break compile"): user text in every place
// the contract lets it reach Python — templates, string constants, topics — must load and come back byte for byte.
const FUZZ = [
  'say "hi"\n\t\\', '""" \'\'\' # \\', "{} {0} %s %d", "\u0000\u0001\u001f\u007f\u0085", "Ünïcode ✓ ữ 車 🚗",
  "\\N{BULLET} \\x41 \\u0041", "   line seps", "import os; os.system('x')", "\\", '"', "", "\r\n\f\v",
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
  const r = generate({ project: { slug: "fuzz", appName: "FuzzApp", language: "python", mqttTopicPrefix: "fuzz", traceLevel: "node" }, workflows: [ir] });
  if (!r.ok) throw new Error(`${id}: ${JSON.stringify(r)}`);
  const dir = join(buildDir, "cases", id);
  const scenario = { scenarioVersion: "1.0.0", name: id, until: 10, inputs: [] };
  if (mode === "prepare") {
    writeFiles(dir, r.fileSet.files);
    writeFileSync(join(dir, "scenario.json"), JSON.stringify(scenario));
  }
  const expectLogs = FUZZ.flatMap((t, i) => (i % 2 ? [] : [`${t}${FUZZ[1]}`]));
  const expectPublishes = FUZZ.flatMap((t, i) => (i % 2 ? [t] : []));
  cases.push({ id, dir, golden: false, module: "fuzz_strings", scenario, fuzz: { logs: expectLogs, publishes: expectPublishes } });
}

if (mode === "prepare") {
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, "cases.json"), JSON.stringify(cases.map((c) => ({ id: c.id, dir: c.dir, module: c.module, golden: c.golden, runId: c.golden ? "golden" : "sim" })), null, 2));
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
    console.log(`FAIL ${c.id}\n  no result (the case did not run, see results/${c.id}.err)`);
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
    if (!same(logs, c.fuzz.logs)) problems.push(`log texts changed: ${stringify(logs)} ≠ ${stringify(c.fuzz.logs)}`);
    if (!same(pubs, c.fuzz.publishes)) problems.push(`publish payloads changed: ${stringify(pubs)} ≠ ${stringify(c.fuzz.publishes)}`);
  }
  if (c.golden) {
    const wantTrace = JSON.parse(readFileSync(join(fixturesDir, "golden", c.id, "expected.trace.json"), "utf8"));
    const wantWrites = JSON.parse(readFileSync(join(fixturesDir, "golden", c.id, "expected.writes.json"), "utf8"));
    if (!same(out.writes, wantWrites)) problems.push(`writes ≠ expected.writes.json: ${stringify(out.writes)}`);
    if (!same(out.trace, wantTrace)) {
      const k = wantTrace.findIndex((e: unknown, i: number) => !same(e, out.trace[i]));
      problems.push(`trace ≠ expected.trace.json at event ${k}: expected ${stringify(wantTrace[k])} actual ${stringify(out.trace[k])}`);
    }
    const pytest = join(buildDir, "results", `${c.id}.pytest`);
    const status = existsSync(pytest) ? readFileSync(pytest, "utf8").trim() : "missing";
    if (status !== "0") problems.push(`generated pytest failed (exit ${status}, log results/${c.id}.pytest.log)`);
  }
  if (problems.length) failed++;
  console.log(`${problems.length ? "FAIL" : "PASS"} ${c.id}${problems.length ? `\n  ${problems.join("\n  ")}` : ""}`);
}
console.log(`conformance (Python runtime + generated code): ${cases.length - failed}/${cases.length} PASS`);
process.exit(failed ? 1 : 0);
