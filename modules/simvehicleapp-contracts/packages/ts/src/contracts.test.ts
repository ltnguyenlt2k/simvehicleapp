import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { CONTRACTS_VERSION, ContractValidator, SCHEMA_NAMES, fixturesDir, loadSchema, schemaId, schemasDir, type ScenarioV1 } from "./index.ts";

const v = new ContractValidator();
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const H = (c: string) => `sha256:${c.repeat(64)}`;

describe("schemas", () => {
  test("every schema file is registered and every registered schema exists", () => {
    const onDisk = readdirSync(schemasDir)
      .filter((f) => f.endsWith(".v1.schema.json"))
      .map((f) => f.replace(".v1.schema.json", ""))
      .sort();
    expect(onDisk).toEqual([...SCHEMA_NAMES].sort());
  });

  test("$id carries name and package version", () => {
    for (const name of SCHEMA_NAMES) expect(loadSchema(name).$id).toBe(schemaId(name));
    expect(readJson(new URL("../../../package.json", import.meta.url).pathname).version).toBe(CONTRACTS_VERSION);
  });
});

describe("diagnostics catalog", () => {
  const catalog = readJson(`${schemasDir}diagnostics-catalog.v1.json`);

  test("validates", () => v.assert("diagnostics-catalog", catalog));

  test("codes are unique and sorted", () => {
    const codes: string[] = catalog.codes.map((c: { code: string }) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort());
  });

  test("covers ADR-0016/0018 codes used by analysis/06 and 05", () => {
    const codes = new Set(catalog.codes.map((c: { code: string }) => c.code));
    for (const c of ["GRAPH_SCHEMA_INVALID", "VEHICLE_WRITE_READ_ONLY", "DATA_REF_NOT_DOMINATING", "ARRAY_VALUE_REQUIRES_INDEXING", "OPCODE_UNSUPPORTED_BY_BACKEND"])
      expect(codes.has(c)).toBe(true);
  });
});

describe("VSS fixtures (T06)", () => {
  test("vss_rel_4.0.json matches the BASELINE pin", () => {
    const sha = createHash("sha256").update(readFileSync(`${fixturesDir}vss/vss_rel_4.0.json`)).digest("hex");
    expect(sha).toBe("925d9e1b5bd187694b3e03051a50777fdd5b46a5a5c4f48fd49ca270a07cdc50");
  });

  test("units.yaml seed parses and has the units used by golden workflows", () => {
    const units = Bun.YAML.parse(readFileSync(`${fixturesDir}vss/units.yaml`, "utf8")) as { units: Record<string, { domain: string }> };
    for (const u of ["km/h", "m/s", "percent", "celsius", "ms", "s"]) expect(units.units[u]?.domain).toBeString();
  });
});

describe("golden GW-A (T06)", () => {
  const graph = readJson(`${fixturesDir}golden/GW-A/graph.json`);
  const scenario = Bun.YAML.parse(readFileSync(`${fixturesDir}golden/GW-A/scenario.yaml`, "utf8")) as ScenarioV1;

  test("graph.json validates", () => v.assert("workflow-graph", graph));
  test("scenario.yaml validates", () => v.assert("scenario", scenario));

  test("edges reference existing blocks", () => {
    const ids = new Set(graph.blocks.map((b: { id: string }) => b.id));
    for (const e of graph.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
  });

  test("every VSS path exists in vss_rel_4.0.json with the expected kind", () => {
    const vss = readJson(`${fixturesDir}vss/vss_rel_4.0.json`);
    const node = (path: string) => path.split(".").slice(1).reduce((n, k) => n?.children?.[k], vss.Vehicle);
    for (const b of graph.blocks) {
      if (!b.props.path) continue;
      const n = node(b.props.path);
      expect(n?.type).toBe(b.type === "sv_set_actuator" ? "actuator" : n?.type);
      expect(["sensor", "actuator", "attribute"]).toContain(n?.type);
    }
    const paths = [...Object.keys(scenario.initial ?? {}), ...scenario.inputs.flatMap((i) => ("path" in i ? [i.path] : []))];
    for (const p of paths) expect(node(p)).toBeDefined();
  });
});

const ir = {
  irVersion: "1.0.0",
  compilerVersion: "0.1.0",
  workflowId: "gw_a",
  workflowRevision: 1,
  name: "StableOverspeedWarning",
  modelHash: H("a"),
  sourceGraphHash: H("b"),
  irHash: H("c"),
  signals: [
    { id: "s0", path: "Vehicle.Speed", vssType: "sensor", dataType: "float", unit: "km/h", access: ["read", "subscribe"] },
    { id: "s1", path: "Vehicle.Body.Lights.Hazard.IsSignaling", vssType: "actuator", dataType: "boolean", unit: null, access: ["write"] },
  ],
  topics: [{ id: "t0", topic: "simvehicleapp/gw-a/hmi", direction: "write" }],
  state: [{ id: "v0", name: "count", type: "int64", initial: "9223372036854775000" }],
  triggers: [
    {
      id: "n1",
      opcode: "event.signal_changed",
      signal: "s0",
      props: { mode: "any", debounceMs: 0 },
      concurrency: { policy: "restart" },
      outputs: { value: { type: "float", unit: "km/h" }, previous: { type: "float", unit: "km/h" }, timestamp: { type: "timestamp", unit: "ms" } },
      entry: "n2",
      src: { blockId: "b1" },
    },
  ],
  nodes: [
    {
      id: "n2",
      opcode: "control.stable_for",
      args: {
        condition: { $expr: { op: ">", l: { $ref: "n1.value" }, r: { $const: 120, type: "float", unit: "km/h" } } },
        durationMs: { $const: "2000", type: "int64" },
      },
      next: { stable: "n3", broken: null },
      src: { blockId: "b2" },
    },
    { id: "n3", opcode: "vehicle.write", args: { signal: "s1", value: { $const: true, type: "boolean" } }, next: { done: "n4", error: null }, src: { blockId: "b3" } },
    {
      id: "n4",
      opcode: "comm.mqtt_publish",
      args: { topic: "t0", payload: { $template: ["Speed ", { $ref: "n1.value" }, " km/h"] } },
      next: {},
      src: { blockId: "b4" },
    },
    {
      id: "n5",
      opcode: "unit.convert",
      args: { value: { $expr: { op: "array.at", value: { $signal: "s0" }, index: { $state: "v0" }, default: { $const: 0, type: "float" } } } },
      next: {},
      src: { blockId: "b4", inserted: true, reason: "unit-conversion" },
    },
  ],
  diagnostics: [],
};

const clone = <T>(x: T): T => structuredClone(x);

describe("IR v1", () => {
  test("valid sample", () => v.assert("ir", ir));

  test("int64 constants must be decimal strings (ADR-0018 §7)", () => {
    const bad = clone(ir);
    (bad.nodes[0]!.args as Record<string, unknown>).durationMs = { $const: 2000, type: "int64" };
    expect(v.validate("ir", bad).valid).toBe(false);
    const badState = clone(ir);
    (badState.state[0] as { initial: unknown }).initial = 9223372036854775000;
    expect(v.validate("ir", badState).valid).toBe(false);
  });

  test("no timestamp/metadata fields allowed at top level (NFR-01)", () => {
    expect(v.validate("ir", { ...ir, generatedAt: "2026-10-03T00:00:00Z" }).valid).toBe(false);
  });

  test("inserted node requires a reason", () => {
    const bad = clone(ir);
    delete (bad.nodes[3]!.src as { reason?: string }).reason;
    expect(v.validate("ir", bad).valid).toBe(false);
  });

  test("signal_changed trigger requires signal + concurrency", () => {
    const bad = clone(ir);
    delete (bad.triggers[0] as { signal?: string }).signal;
    expect(v.validate("ir", bad).valid).toBe(false);
  });

  test("malformed expressions are rejected", () => {
    for (const expr of [{ $const: 1 }, { $ref: "value" }, { $expr: { l: { $const: 1, type: "int32" } } }, { $signal: "s0", extra: 1 }]) {
      const bad = clone(ir);
      (bad.nodes[0]!.args as Record<string, unknown>).condition = expr;
      expect(v.validate("ir", bad).valid).toBe(false);
    }
  });
});

describe("WorkflowGraph v1", () => {
  const graph = readJson(`${fixturesDir}golden/GW-A/graph.json`);

  test("int64 variable initial must be a string", () => {
    expect(v.validate("workflow-graph", { ...graph, variables: [{ name: "odo", type: "uint64", initial: "18446744073709551615" }] }).valid).toBe(true);
    expect(v.validate("workflow-graph", { ...graph, variables: [{ name: "odo", type: "uint64", initial: 1 }] }).valid).toBe(false);
  });

  test("rejects non sv_ block types and unknown fields", () => {
    const bad = clone(graph);
    bad.blocks[0].type = "agent";
    expect(v.validate("workflow-graph", bad).valid).toBe(false);
    expect(v.validate("workflow-graph", { ...graph, position: {} }).valid).toBe(false);
  });
});

describe("Diagnostic v1", () => {
  const d = {
    code: "VEHICLE_WRITE_READ_ONLY",
    severity: "error",
    stage: "vehicle-model",
    blockId: "b7",
    field: "path",
    message: "Vehicle.Speed is a sensor and cannot be written.",
    suggestion: "Choose a VSS actuator.",
    docs: "diagnostics#VEHICLE_WRITE_READ_ONLY",
  };
  test("valid", () => v.assert("diagnostics", d));
  test("422 list", () => v.assert("diagnostics#/$defs/list", { diagnostics: [d] }));
  test("rejects unknown stage / lowercase code", () => {
    expect(v.validate("diagnostics", { ...d, stage: "compile" }).valid).toBe(false);
    expect(v.validate("diagnostics", { ...d, code: "bad_code" }).valid).toBe(false);
  });
});

describe("BlockSpec v1", () => {
  const spec = {
    specVersion: "1.0.0",
    type: "sv_read_signal",
    version: 1,
    category: "sensors",
    title: "Read signal",
    priority: "P0",
    opcode: "vehicle.read",
    vssKinds: ["sensor", "actuator"],
    props: [
      { name: "path", kind: "vss-path", required: true },
      { name: "source", kind: "enum", required: false, enum: ["latest-from-trigger", "fresh-read"], default: "latest-from-trigger" },
    ],
    outputs: [
      { name: "value", type: "$signal", unit: "$signal" },
      { name: "timestamp", type: "timestamp", unit: "ms" },
    ],
    handles: { in: ["in"], out: ["done", "error"] },
  };
  test("valid", () => v.assert("block-spec", spec));
  test("enum prop requires values", () => {
    const bad = clone(spec);
    delete (bad.props[1] as { enum?: unknown }).enum;
    expect(v.validate("block-spec", bad).valid).toBe(false);
  });
});

describe("GeneratedFileSet v1", () => {
  const fs = {
    backend: "cpp@0.1.0",
    runtimeVersion: "0.1.0",
    files: [{ path: "app/src/generated/workflows/StableOverspeedWarning.cpp", content: "// x\n", sha256: "d".repeat(64), role: "source" }],
    ownedRoots: ["app/src/generated/", "app/tests/generated/"],
    manifestFragment: { "vehicle-signal-interface": { required: [{ path: "Vehicle.Speed", access: "read" }] } },
    sourceMaps: [{ file: "app/src/generated/workflows/StableOverspeedWarning.cpp", ranges: [{ startLine: 1, endLine: 2, nodeId: "n2", blockId: "b2", workflowId: "gw_a" }] }],
    diagnostics: [],
  };
  test("valid", () => v.assert("generated-fileset", fs));
  test.each(["/etc/passwd", "../x.cpp", "app/../../x", "app/./x", "app//x", "app\\x.cpp", "app/src/generated/"])("rejects unsafe file path %p", (path) => {
    const bad = clone(fs);
    bad.files[0]!.path = path;
    expect(v.validate("generated-fileset", bad).valid).toBe(false);
  });
  test("owned roots must end with /", () => {
    expect(v.validate("generated-fileset", { ...fs, ownedRoots: ["app/src/generated"] }).valid).toBe(false);
  });
  test("generate request embeds IR v1", () => {
    v.assert("generated-fileset#/$defs/generateRequest", {
      project: { slug: "comfort-app", appName: "ComfortApp", language: "cpp", mqttTopicPrefix: "simvehicleapp/comfort-app", traceLevel: "node" },
      workflows: [ir],
      options: { emitTests: true },
    });
  });
});

describe("BackendCapabilities v1", () => {
  const caps = {
    id: "cpp",
    name: "compiler-code-cpp",
    version: "0.1.0",
    language: "cpp",
    irVersions: ">=1.0.0 <2.0.0",
    contracts: ">=1.0.0 <2.0.0",
    opcodes: ["event.app_start", "event.signal_changed", "vehicle.write", "control.stable_for", "comm.mqtt_publish"],
    features: { concurrencyPolicies: ["restart", "ignore", "queue", "parallel"], trace: true, sourceMaps: true },
    runtime: { name: "simvehicleapp-runtime-cpp", version: "0.1.0", vendorPath: "app/src/simvehicleapp-runtime" },
    toolchain: { id: "toolchain-cpp", template: "vehicle-app-cpp-template", templateSha: "275e858e3de8f43d6b4c71a389e358dffe73b42b" },
  };
  test("valid", () => v.assert("backend-capabilities", caps));
  test("rejects unknown opcode", () => {
    expect(v.validate("backend-capabilities", { ...caps, opcodes: ["vehicle.teleport"] }).valid).toBe(false);
  });
});

describe("streams and jobs", () => {
  test("toolchain job + request", () => {
    v.assert("toolchain-job#/$defs/request", { kind: "build", project: "comfort-app", options: { release: true } });
    v.assert("toolchain-job", { id: "j_1", kind: "build", project: "comfort-app", state: "running", createdAt: 1759200000000 });
    expect(v.validate("toolchain-job#/$defs/request", { kind: "rm", project: "comfort-app" }).valid).toBe(false);
  });

  test("trace event: node events need wf/run/node, system events do not", () => {
    v.assert("trace-event", { runId: "r_12", seq: 1043, ts: 1759200000125, wf: "gw_a", run: 42, node: "n2", blockId: "b2", ev: "enter", data: { value: 131.2 } });
    v.assert("trace-event", { runId: "r_12", seq: 1, ts: 1759200000000, ev: "app.started" });
    expect(v.validate("trace-event", { runId: "r_12", seq: 2, ts: 1, ev: "enter" }).valid).toBe(false);
    v.assert("trace-event#/$defs/runtimeLine", { v: 1, ts: 1759200000125, app: "ComfortApp", wf: "gw_a", run: 42, node: "n2", ev: "exit", data: {} });
  });

  test("log line", () => {
    v.assert("log-line", { runId: "r_12", seq: 1042, ts: 1759200000123, stream: "stdout", level: "info", msg: "hello", raw: "hello" });
    expect(v.validate("log-line", { runId: "r_12", seq: -1, ts: 0, stream: "stdout", level: "info", msg: "" }).valid).toBe(false);
  });

  test("signal update + client messages", () => {
    v.assert("signal-update", { path: "Vehicle.Speed", ts: 1759200000100, value: 131.2, field: "value" });
    v.assert("signal-update#/$defs/clientMessage", { op: "subscribe", paths: ["Vehicle.Speed"] });
    v.assert("signal-update#/$defs/clientMessage", { op: "set", path: "Vehicle.Speed", value: 130, field: "value" });
    expect(v.validate("signal-update#/$defs/clientMessage", { op: "set", path: "Vehicle.Speed", value: 1 }).valid).toBe(false);
    expect(v.validate("signal-update", { path: "Speed", ts: 1, value: 1, field: "value" }).valid).toBe(false);
  });
});

describe("WorkflowPatch v1", () => {
  const patch = {
    patchVersion: "1.0.0",
    workflowId: "wf_7Hk",
    baseRevision: 31,
    ops: [
      { op: "add_block", ref: "t1", type: "sv_on_signal_changed", name: "SoC changed", props: { path: "Vehicle.Powertrain.TractionBattery.StateOfCharge.Current", mode: "any" }, position: "auto" },
      { op: "add_block", ref: "c1", type: "sv_if", props: { condition: "<SoC changed.value> < 20 && <Vehicle.IsMoving>" } },
      { op: "connect", from: "t1", fromHandle: "next", to: "c1" },
      { op: "set_props", block: "b5", props: { durationMs: 3000 } },
      { op: "remove_block", block: "b9" },
    ],
    rationale: "…",
  };
  test("valid (analysis/09 §5 example)", () => v.assert("workflow-patch", patch));
  test("rejects unknown op and empty set_props", () => {
    expect(v.validate("workflow-patch", { ...patch, ops: [{ op: "write_code", code: "x" }] }).valid).toBe(false);
    expect(v.validate("workflow-patch", { ...patch, ops: [{ op: "set_props", block: "b1", props: {} }] }).valid).toBe(false);
  });
});

describe("scenario v1", () => {
  test("until is capped at 24h and inputs need path xor topic", () => {
    const base = { scenarioVersion: "1.0.0", name: "x", until: 1000, inputs: [] };
    v.assert("scenario", base);
    expect(v.validate("scenario", { ...base, until: 86400001 }).valid).toBe(false);
    expect(v.validate("scenario", { ...base, inputs: [{ t: 0, path: "Vehicle.Speed", topic: "a", value: 1 }] }).valid).toBe(false);
    v.assert("scenario", { ...base, inputs: [{ t: 0, path: "Vehicle.OBD.PidsA", value: ["01", "02"] }] });
  });
});

describe("GenerationManifest v1", () => {
  const m = {
    manifestVersion: "1.0.0",
    backend: "cpp@0.1.0",
    runtimeVersion: "0.1.0",
    contracts: "1.0.0-alpha.1",
    workflows: [{ workflowId: "gw_a", revision: 1, irHash: H("c") }],
    ownedRoots: ["app/src/generated/"],
    files: [{ path: "app/src/generated/Main.cpp", sha256: "e".repeat(64), role: "source" }],
  };
  test("deterministic in-tree copy (no generationId) and workspace record", () => {
    v.assert("generation-manifest", m);
    v.assert("generation-manifest", { ...m, generationId: "g_1", project: "comfort-app" });
  });
  test("rejects timestamps and unsafe paths", () => {
    expect(v.validate("generation-manifest", { ...m, generatedAt: 1 }).valid).toBe(false);
    expect(v.validate("generation-manifest", { ...m, files: [{ path: "../x", sha256: "e".repeat(64) }] }).valid).toBe(false);
  });
});

describe("License v1", () => {
  const { generateKeyPairSync, sign } = require("node:crypto") as typeof import("node:crypto");
  const { privateKey } = generateKeyPairSync("ed25519");
  const body = {
    licenseVersion: "1.0.0",
    edition: "full",
    licensee: "local",
    features: { "export.source": true, "ai.assistant": true, languages: ["cpp"] },
    limits: {},
    expiry: null,
  };
  const signature = sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString("base64");
  test("valid with a real Ed25519 signature", () => v.assert("license", { ...body, signature }));
  test("rejects unknown feature and bad expiry", () => {
    expect(v.validate("license", { ...body, signature, features: { "ee.sso": true } }).valid).toBe(false);
    expect(v.validate("license", { ...body, signature, expiry: "2026-13-01" }).valid).toBe(false);
  });
});

describe("ServiceInfo v1", () => {
  test("version + health bodies", () => {
    v.assert("service-info", { name: "compiler", version: "0.1.0", commit: "8d11a9a", contracts: "1.0.0-alpha.1" });
    v.assert("service-info", { name: "toolchain-cpp", version: "0.1.0", commit: "unknown", contracts: "1.0.0-alpha.1", velocitasCli: "0.13.2" });
    v.assert("service-info#/$defs/health", { status: "ok" });
    expect(v.validate("service-info", { name: "compiler", version: "0.1" }).valid).toBe(false);
  });
});
