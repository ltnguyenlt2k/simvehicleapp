import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSchema, SCHEMA_NAMES } from "@simvehicleapp/contracts";
import { createLogger, createService } from "@simvehicleapp/service-kit";
import { BLOCK_SPECS } from "@simvehicleapp/blocks";
import { createCompilerHandler } from "./app.ts";
import { CatalogUnavailableError } from "./vehicle-lookup.ts";

let catalogDown = false;
const vehicle = async (_release: string, paths: readonly string[]) => {
  if (catalogDown) throw new CatalogUnavailableError("down");
  return new Map(paths.map((p) => [p, p === "Vehicle.Speed" ? ({ path: p, name: "Speed", kind: "sensor", datatype: "float", unit: "km/h" } as const) : null]));
};

const SECRET = "test-secret";
const handler = createService(
  { name: "compiler", version: "0.1.0", secret: SECRET, logger: createLogger({ service: "compiler", write: () => {} }) },
  createCompilerHandler({ vehicle }),
);
const call = (path: string, init: RequestInit = {}) =>
  handler(new Request(`http://compiler:4020${path}`, { ...init, headers: { "x-sv-internal": SECRET, ...(init.headers ?? {}) } }));

const openapi = Bun.YAML.parse(
  readFileSync(fileURLToPath(import.meta.resolve("@simvehicleapp/contracts/openapi/compiler.v1.yaml")), "utf8"),
) as Record<string, any>;
const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
for (const name of SCHEMA_NAMES) ajv.addSchema(loadSchema(name));

test("GET /blocks conforms to the contract and lists every BlockSpec sorted by type", async () => {
  const res = await call("/blocks");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { blocks: { type: string }[] };
  const validate = ajv.compile(openapi.paths["/blocks"].get.responses["200"].content["application/json"].schema);
  if (!(validate(body) as boolean)) throw new Error(ajv.errorsText(validate.errors));
  const types = body.blocks.map((b: { type: string }) => b.type);
  expect(types).toEqual(BLOCK_SPECS.map((s) => s.type));
  expect(types).toEqual([...types].sort());
  for (const t of ["sv_on_signal_changed", "sv_read_attribute", "sv_read_signal", "sv_set_actuator"]) expect(types).toContain(t);
});

test("GET /blocks has a stable ETag and honours If-None-Match", async () => {
  const etag = (await call("/blocks")).headers.get("etag")!;
  expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect((await call("/blocks")).headers.get("etag")).toBe(etag);
  const res = await call("/blocks", { headers: { "if-none-match": etag } });
  expect(res.status).toBe(304);
  expect(await res.text()).toBe("");
});

test("auth is required; /healthz and /version are public", async () => {
  expect((await handler(new Request("http://compiler:4020/blocks"))).status).toBe(401);
  expect((await handler(new Request("http://compiler:4020/healthz"))).status).toBe(200);
  expect((await (await handler(new Request("http://compiler:4020/version"))).json()).name).toBe("compiler");
});

test("unknown routes 404, wrong method 405", async () => {
  expect((await call("/nope")).status).toBe(404);
  expect((await call("/blocks", { method: "POST" })).status).toBe(405);
  expect((await call("/simulate")).status).toBe(405);
});

const graph = (path: string) => ({
  graphVersion: "1.0.0",
  workflowId: "wf",
  revision: 1,
  name: "t",
  vss: { release: "v4.0" },
  variables: [],
  blocks: [{ id: "b1", type: "sv_read_signal", name: "Read", props: { path }, parentId: null }],
  edges: [],
});

test("POST /lint returns diagnostics that conform to the contract (M03-T11)", async () => {
  const res = await call("/lint", { method: "POST", body: JSON.stringify({ graph: graph("Vehicle.Nope") }), headers: { "content-type": "application/json" } });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { diagnostics: { code: string; blockId?: string }[] };
  const validate = ajv.compile(openapi.paths["/lint"].post.responses["200"].content["application/json"].schema);
  if (!(validate(body) as boolean)) throw new Error(ajv.errorsText(validate.errors));
  expect(body.diagnostics.map((d) => d.code).sort()).toEqual(["BLOCK_UNREACHABLE", "VEHICLE_PATH_NOT_FOUND"]);
});

test("POST /lint input errors and catalog outage", async () => {
  const post = (body: string) => call("/lint", { method: "POST", body, headers: { "content-type": "application/json" } });
  expect((await post("{")).status).toBe(400);
  expect((await post("{}")).status).toBe(400);
  expect((await call("/lint")).status).toBe(405);
  const schema = await post(JSON.stringify({ graph: { nope: 1 } }));
  expect(((await schema.json()) as { diagnostics: { code: string }[] }).diagnostics[0]!.code).toBe("GRAPH_SCHEMA_INVALID");
  catalogDown = true;
  expect((await post(JSON.stringify({ graph: graph("Vehicle.Speed") }))).status).toBe(503);
  catalogDown = false;
});

// --- M04-T10: /compile and /opcodes over the real VSS fixtures ---
import { fixtureContext } from "@simvehicleapp/compiler/src/golden-ir.ts";
import { fixturesDir } from "@simvehicleapp/contracts";

const fx = fixtureContext();
let realCatalogDown = false;
const real = createService(
  { name: "compiler", version: "0.1.0", secret: SECRET, logger: createLogger({ service: "compiler", write: () => {} }) },
  createCompilerHandler({
    vehicle: async (release, paths) => {
      if (realCatalogDown) throw new CatalogUnavailableError("down");
      return fx.vehicle(release, paths);
    },
    modelHash: fx.modelHash,
    capabilities: async (id) =>
      id === "cpp"
        ? {
            id: "cpp",
            name: "compiler-code-cpp",
            version: "0.1.0",
            language: "cpp",
            irVersions: ">=1.0.0 <2.0.0",
            contracts: ">=1.0.0-alpha.1 <2.0.0",
            opcodes: ["event.signal_changed", "vehicle.write"],
            features: { concurrencyPolicies: ["restart"], trace: true, sourceMaps: true },
            runtime: { name: "rt", version: "0.1.0", vendorPath: "vendor/rt" },
            toolchain: { id: "toolchain-cpp", template: "t", templateSha: "0".repeat(40) },
          }
        : null,
  }),
);
const post = (path: string, body: unknown) =>
  real(new Request(`http://compiler:4020${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "x-sv-internal": SECRET, "content-type": "application/json" } }));
const gwa = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/graph.json`, "utf8"));
const compileSchema = () => ajv.compile(openapi.paths["/compile"].post.responses["200"].content["application/json"].schema);

test("POST /compile build returns the golden IR and conforms to the contract", async () => {
  const res = await post("/compile", { graph: gwa, mode: "build" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ir?: unknown; diagnostics: { severity: string }[] };
  const validate = compileSchema();
  if (!(validate(body) as boolean)) throw new Error(ajv.errorsText(validate.errors));
  expect(body.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(body.ir).toEqual(JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/ir.json`, "utf8")));
});

test("POST /compile verify/lint return diagnostics only; S7 runs when a target is given", async () => {
  const verify = (await (await post("/compile", { graph: gwa, mode: "verify" })).json()) as { ir?: unknown };
  expect(verify.ir).toBeUndefined();
  const lintBody = (await (await post("/compile", { graph: gwa, mode: "lint" })).json()) as { diagnostics: unknown[] };
  expect(lintBody).toEqual((await (await post("/lint", { graph: gwa })).json()) as never);
  const s7 = (await (await post("/compile", { graph: gwa, mode: "build", target: "cpp" })).json()) as { ir?: unknown; diagnostics: { code: string; blockId?: string }[] };
  expect(s7.ir).toBeUndefined();
  expect(s7.diagnostics.filter((d) => d.code === "OPCODE_UNSUPPORTED_BY_BACKEND").map((d) => d.blockId)).toEqual(["b2", "b4"]);
  const unknown = (await (await post("/compile", { graph: gwa, mode: "verify", target: "rust" })).json()) as { diagnostics: { code: string }[] };
  expect(unknown.diagnostics.map((d) => d.code)).toContain("BACKEND_UNAVAILABLE");
});

test("POST /compile input errors and catalog outage", async () => {
  expect((await post("/compile", "{")).status).toBe(400);
  expect((await post("/compile", { mode: "build" })).status).toBe(400);
  expect((await post("/compile", { graph: gwa, mode: "run" })).status).toBe(400);
  expect((await post("/compile", { graph: gwa, mode: "build", target: "C++" })).status).toBe(400);
  realCatalogDown = true;
  try {
    expect((await post("/compile", { graph: gwa, mode: "build" })).status).toBe(503);
  } finally {
    realCatalogDown = false;
  }
});

test("GET /opcodes lists the opcodes the compiler emits", async () => {
  const res = await call("/opcodes");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { irVersion: string; opcodes: string[] };
  const validate = ajv.compile(openapi.paths["/opcodes"].get.responses["200"].content["application/json"].schema);
  if (!(validate(body) as boolean)) throw new Error(ajv.errorsText(validate.errors));
  expect(body.irVersion).toBe("1.0.0");
  for (const op of ["event.signal_changed", "vehicle.write", "logic.eval", "comm.mqtt_publish", "control.parallel"]) expect(body.opcodes).toContain(op);
  for (const op of ["expr", "const", "comm.hmi_notify"]) expect(body.opcodes).not.toContain(op);
  expect(body.opcodes).toEqual([...body.opcodes].sort());
});

test("performance: a 200-block graph compiles (build) in under 300 ms (M04-T10)", async () => {
  // When Speed changes → 199 alternating If / Set steps (then-branches), every expression typed.
  const blocks: unknown[] = [{ id: "b000", type: "sv_on_signal_changed", name: "Speed changed", props: { path: "Vehicle.Speed", mode: "any" }, parentId: null, blockVersion: 1 }];
  const edges: unknown[] = [];
  for (let i = 1; i < 200; i++) {
    const id = `b${String(i).padStart(3, "0")}`;
    const prev = blocks[i - 1] as { id: string; type: string };
    blocks.push(
      i % 2
        ? { id, type: "sv_if", name: `Check ${i}`, props: { condition: `<speedchanged.value> > ${i} && <Vehicle.IsMoving>` }, parentId: null, blockVersion: 1 }
        : { id, type: "sv_set_actuator", name: `Set ${i}`, props: { path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: `<speedchanged.value> > ${i * 2}` }, parentId: null, blockVersion: 1 },
    );
    edges.push({ id: `e${i}`, from: prev.id, fromHandle: prev.type === "sv_if" ? "then" : "source", to: id, toHandle: "target" });
  }
  const g = { ...gwa, workflowId: "perf", name: "Perf", blocks, edges };
  await post("/compile", { graph: g, mode: "build" }); // warm-up (JIT, schema compile)
  const times: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now();
    const res = await post("/compile", { graph: g, mode: "build" });
    times.push(performance.now() - t0);
    const body = (await res.json()) as { ir?: { nodes: unknown[] }; diagnostics: { severity: string; code: string }[] };
    expect(body.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(body.ir?.nodes).toHaveLength(199);
  }
  times.sort((a, b) => a - b);
  expect(times[1]!).toBeLessThan(300);
});

// --- M05-T07: /simulate ---
const scenarioOf = (id: string) => Bun.YAML.parse(readFileSync(`${fixturesDir}${id}/scenario.yaml`, "utf8"));
const gwaIr = JSON.parse(readFileSync(`${fixturesDir}golden/GW-A/ir.json`, "utf8"));

test("POST /simulate runs the golden GW-A scenario and conforms to the contract", async () => {
  const res = await post("/simulate", { ir: gwaIr, scenario: scenarioOf("golden/GW-A") });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { writes: unknown[]; trace: { runId: string }[]; expectations: { passed: boolean; mismatches: string[] }; diagnostics: unknown[] };
  const validate = ajv.compile(openapi.paths["/simulate"].post.responses["200"].content["application/json"].schema);
  if (!(validate(body) as boolean)) throw new Error(ajv.errorsText(validate.errors));
  expect(body.expectations).toEqual({ passed: true, mismatches: [] });
  expect(body.writes).toEqual([
    { t: 5000, path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: true },
    { t: 6000, path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: false },
  ]);
  expect(body.diagnostics).toEqual([]);
});

test("POST /simulate rejects bodies off contract and reports the event limit", async () => {
  expect((await post("/simulate", "{")).status).toBe(400);
  expect((await post("/simulate", { ir: { irVersion: "1.0.0" }, scenario: scenarioOf("golden/GW-A") })).status).toBe(400);
  expect((await post("/simulate", { ir: gwaIr, scenario: { name: "x" } })).status).toBe(400);
  const capped = createService(
    { name: "compiler", version: "0.1.0", secret: SECRET, logger: createLogger({ service: "compiler", write: () => {} }) },
    createCompilerHandler({ vehicle: fx.vehicle, modelHash: fx.modelHash, simMaxEvents: 50 }),
  );
  const flood = {
    scenarioVersion: "1.0.0",
    name: "flood",
    until: 86_400_000,
    inputs: Array.from({ length: 100 }, (_, i) => ({ t: i, path: "Vehicle.Speed", value: i % 2 ? 200 : 0 })),
  };
  const res = await capped(new Request("http://compiler:4020/simulate", { method: "POST", body: JSON.stringify({ ir: gwaIr, scenario: flood }), headers: { "x-sv-internal": SECRET, "content-type": "application/json" } }));
  const body = (await res.json()) as { diagnostics: { code: string; severity: string; data: { events: number } }[] };
  expect(body.diagnostics).toEqual([expect.objectContaining({ code: "SIM_LIMIT_REACHED", severity: "warning", data: expect.objectContaining({ events: 50 }) })]);
});
