import { beforeAll, describe, expect, test } from "bun:test";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSchema, SCHEMA_NAMES } from "@simvehicleapp/contracts";
import { createLogger, createService } from "@simvehicleapp/service-kit";
import { LocalFileSource, type ReleaseFiles, type VehicleModelSource } from "@simvehicleapp/vss";
import { Catalog } from "./catalog.ts";
import { createCatalogHandler } from "./app.ts";

const contractFile = (rel: string) => fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/${rel}`));
const SECRET = "test-secret";
const logs: string[] = [];

const seeded = new LocalFileSource([
  { release: "v4.0", json: contractFile("fixtures/vss/vss_rel_4.0.json") },
  { release: "v4.2", json: contractFile("fixtures/vss/vss_rel_4.2.json") },
]);

function app(source: VehicleModelSource = seeded) {
  return createService(
    { name: "vss-catalog", version: "0.1.0", secret: SECRET, logger: createLogger({ service: "vss-catalog", write: (l) => logs.push(l) }) },
    createCatalogHandler(new Catalog(source, "v4.0")),
  );
}

const handler = app();
const get = (path: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://vss-catalog:4010${path}`, { headers: { "x-sv-internal": SECRET, ...headers } }));

/** Response schemas of `openapi/vss-catalog.v1.yaml`, with document-local `$ref`s inlined for Ajv. */
const openapi = Bun.YAML.parse(readFileSync(contractFile("openapi/vss-catalog.v1.yaml"), "utf8")) as Record<string, any>;
const inline = (node: any): any => {
  if (Array.isArray(node)) return node.map(inline);
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    return inline(node.$ref.slice(2).split("/").reduce((n: any, k: string) => n[k], openapi));
  }
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, inline(v)]));
};
const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
for (const name of SCHEMA_NAMES) ajv.addSchema(loadSchema(name));
const schemaFor = (path: string, status: string): ValidateFunction => {
  const res = inline(openapi.paths[path].get.responses[status]);
  return ajv.compile(res.content["application/json"].schema);
};

async function conforming(path: string, query = "", status = "200") {
  const res = await get(`${path}${query}`);
  expect(res.status).toBe(Number(status));
  const body = await res.json();
  const validate = schemaFor(path, status);
  if (!validate(body)) throw new Error(`${path}${query}: ${ajv.errorsText(validate.errors)}`);
  return { res, body: body as Record<string, any> };
}

describe("contract conformance (openapi/vss-catalog.v1.yaml)", () => {
  test("every documented operation is served", () => {
    expect(Object.keys(openapi.paths).sort()).toEqual(["/healthz", "/model-hash", "/nodes", "/releases", "/search", "/tree", "/version", "/vss"]);
  });

  test("/healthz and /version are public", async () => {
    const health = await handler(new Request("http://vss-catalog:4010/healthz"));
    expect(health.status).toBe(200);
    expect(schemaFor("/healthz", "200")(await health.json())).toBe(true);
    const version = await handler(new Request("http://vss-catalog:4010/version"));
    const info = await version.json();
    expect(schemaFor("/version", "200")(info)).toBe(true);
    expect(info.name).toBe("vss-catalog");
  });

  test("catalog routes require x-sv-internal (fail closed)", async () => {
    expect((await handler(new Request("http://vss-catalog:4010/releases"))).status).toBe(401);
    expect((await get("/releases", { "x-sv-internal": "wrong" })).status).toBe(401);
  });

  test("/releases lists seeds with the default flagged", async () => {
    const { body } = await conforming("/releases");
    expect(body.releases).toEqual([{ release: "v4.0", default: true }, { release: "v4.2" }]);
  });

  test("/tree without prefix starts below the root, depth 1", async () => {
    const { body } = await conforming("/tree");
    expect(body.release).toBe("v4.0");
    expect(body.nodes.map((n: any) => n.path)).toContain("Vehicle.Speed");
    expect(body.nodes.every((n: any) => n.path.split(".").length === 2)).toBe(true);
    expect(body.nodes.find((n: any) => n.path === "Vehicle.Cabin").hasChildren).toBe(true);
    expect(body.nodes.find((n: any) => n.path === "Vehicle.Speed").hasChildren).toBeUndefined();
  });

  test("/tree with prefix and depth is lazy and in release order", async () => {
    const { body } = await conforming("/tree", "?prefix=Vehicle.Cabin.Door&depth=2");
    const paths = body.nodes.map((n: any) => n.path);
    expect(paths.slice(0, 3)).toEqual(["Vehicle.Cabin.Door.Row1", "Vehicle.Cabin.Door.Row1.DriverSide", "Vehicle.Cabin.Door.Row1.PassengerSide"]);
    expect(paths.every((p: string) => p.split(".").length <= 5)).toBe(true);
    const full = await conforming("/tree", "?depth=16");
    expect(full.body.nodes).toHaveLength(1196);
  });

  test("/tree on v4.2 differs without any rebuild", async () => {
    const { body } = await conforming("/tree", "?release=v4.2&prefix=Vehicle.Body");
    expect(body.release).toBe("v4.2");
    expect(body.nodes.map((n: any) => n.path)).toContain("Vehicle.Body.RefuelPosition");
  });

  test("/search ranks and filters", async () => {
    const { body } = await conforming("/search", "?q=state%20of%20charge&type=sensor");
    expect(body.nodes[0].path).toBe("Vehicle.Powertrain.TractionBattery.StateOfCharge.Current");
    expect(body.nodes.every((n: any) => n.kind === "sensor")).toBe(true);
    expect(body.nodes.length).toBeLessThanOrEqual(50);
  });

  test("/nodes returns request order and reports unknown paths", async () => {
    const { body } = await conforming("/nodes", "?paths=Vehicle.Speed,Vehicle.Body.Lights.Hazard.IsSignaling,Vehicle.Nope,Vehicle.Speed");
    expect(body.nodes.map((n: any) => [n.path, n.kind, n.datatype])).toEqual([
      ["Vehicle.Speed", "sensor", "float"],
      ["Vehicle.Body.Lights.Hazard.IsSignaling", "actuator", "boolean"],
    ]);
    expect(body.unknown).toEqual(["Vehicle.Nope"]);
    const known = await conforming("/nodes", "?paths=Vehicle.Speed");
    expect(known.body.unknown).toBeUndefined();
  });

  test("/vss is the release document the model was parsed from (vendored into projects)", async () => {
    const res = await get("/vss?release=v4.2");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-sv-release")).toBe("v4.2");
    const doc = await res.json();
    expect(Object.keys(doc)).toEqual(["Vehicle"]);
    expect(doc.Vehicle.children.Speed.datatype).toBe("float");
    expect((await get("/vss?release=v4.2", { "if-none-match": res.headers.get("etag")! })).status).toBe(304);
    expect((await get("/vss?release=v9.9")).status).toBe(404);
  });

  test("/model-hash matches the parsed model", async () => {
    const { body } = await conforming("/model-hash", "?release=v4.2");
    expect(body).toEqual({ release: "v4.2", modelHash: "sha256:5ce5cb9bd23f580c8d29697e6d7ccd43b8cf0db1631912fa8b03e8d964c1f1c5" });
  });
});

describe("ETag (ADR-0010 §7)", () => {
  test("same request ⇒ same strong ETag; If-None-Match ⇒ 304 without body", async () => {
    const a = await get("/tree?prefix=Vehicle.Cabin");
    const b = await get("/tree?prefix=Vehicle.Cabin");
    const etag = a.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(b.headers.get("etag")).toBe(etag);
    const c = await get("/tree?prefix=Vehicle.Cabin", { "if-none-match": `W/${etag}, "other"` });
    expect(c.status).toBe(304);
    expect(await c.text()).toBe("");
    expect(c.headers.get("etag")).toBe(etag);
    const other = await get("/tree?prefix=Vehicle.Cabin&release=v4.2");
    expect(other.headers.get("etag")).not.toBe(etag);
  });
});

describe("errors", () => {
  test.each([
    ["/tree?release=4.0", 400, "invalid_request"],
    ["/tree?prefix=Vehicle", 400, "invalid_request"],
    ["/tree?depth=0", 400, "invalid_request"],
    ["/tree?depth=17", 400, "invalid_request"],
    ["/tree?depth=1.5", 400, "invalid_request"],
    ["/search", 400, "invalid_request"],
    [`/search?q=${"x".repeat(201)}`, 400, "invalid_request"],
    ["/search?q=speed&type=signal", 400, "invalid_request"],
    ["/nodes", 400, "invalid_request"],
    ["/nodes?paths=Vehicle", 400, "invalid_request"],
    [`/nodes?paths=${Array(2001).fill("Vehicle.Speed").join(",")}`, 400, "invalid_request"],
    ["/tree?prefix=Vehicle.Nope", 404, "unknown_path"],
    ["/tree?release=v9.9", 404, "unknown_release"],
    ["/model-hash?release=v9.9", 404, "unknown_release"],
    ["/elsewhere", 404, "not_found"],
  ])("%s ⇒ %i %s", async (path, status, error) => {
    const res = await get(path);
    expect(res.status).toBe(status);
    expect((await res.json()).error).toBe(error);
  });

  test("POST is rejected", async () => {
    const res = await handler(new Request("http://vss-catalog:4010/releases", { method: "POST", headers: { "x-sv-internal": SECRET } }));
    expect(res.status).toBe(405);
  });

  test("leaf prefix gives an empty node list", async () => {
    const { body } = await conforming("/tree", "?prefix=Vehicle.Speed");
    expect(body.nodes).toEqual([]);
  });

  describe("broken source", () => {
    let calls = 0;
    const flaky: VehicleModelSource = {
      name: "flaky",
      releases: async () => ["v4.0"],
      load: async (release): Promise<ReleaseFiles> => {
        calls++;
        if (calls === 1) return { release, document: { Vehicle: { type: "sensor" } }, sha256: "x", origin: "test" };
        return (await seeded.load(release))!;
      },
    };
    const broken = app(flaky);
    beforeAll(() => {
      logs.length = 0;
    });

    test("invalid release data ⇒ 503 without details, logged; next request retries", async () => {
      const req = () => broken(new Request("http://vss-catalog:4010/model-hash", { headers: { "x-sv-internal": SECRET } }));
      const res = await req();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "release_unavailable" });
      expect(logs.some((l) => l.includes("release unavailable") && l.includes("root must be a branch"))).toBe(true);
      expect((await req()).status).toBe(200);
      expect(calls).toBe(2);
    });
  });
});
