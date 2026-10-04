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

test("routes of later milestones answer 501, unknown routes 404, wrong method 405", async () => {
  for (const p of ["/compile", "/simulate", "/opcodes"]) {
    expect(Object.keys(openapi.paths)).toContain(p);
    const res = await call(p, { method: p === "/opcodes" ? "GET" : "POST" });
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("not_implemented");
  }
  expect((await call("/nope")).status).toBe(404);
  expect((await call("/blocks", { method: "POST" })).status).toBe(405);
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
