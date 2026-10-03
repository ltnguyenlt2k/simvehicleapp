import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, readdirSync } from "node:fs";
import { CONTRACTS_VERSION, ContractValidator, openapiDir } from "./index.ts";

const EXPECTED = ["ai-assistant", "backend-plugin", "compiler", "orchestrator", "signal-gateway", "toolchain", "vss-catalog", "workspace"];
// Ajv mis-evaluates `$dynamicRef` together with `unevaluatedProperties`. In this meta-schema `#meta` only
// points at `$defs/schema` (any object/boolean; Schema Objects are checked separately), so a plain `$ref` is equivalent.
const oas = JSON.parse(
  readFileSync(new URL("../../../tools/vendor/oas-3.1-schema-2022-10-07.json", import.meta.url), "utf8").replaceAll(
    '"$dynamicRef": "#meta"',
    '"$ref": "#/$defs/schema"',
  ),
);
const validateOas = new Ajv2020({ strict: false, validateFormats: false, allErrors: true }).compile(oas);
const contracts = new ContractValidator();

const docs = readdirSync(openapiDir)
  .filter((f) => f.endsWith(".v1.yaml"))
  .sort()
  .map((f) => ({ name: f.replace(".v1.yaml", ""), doc: Bun.YAML.parse(readFileSync(`${openapiDir}${f}`, "utf8")) as Record<string, any> }));

function refs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) k === "$ref" && typeof v === "string" ? out.push(v) : refs(v, out);
  return out;
}

const pointer = (doc: unknown, ptr: string) =>
  ptr
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<any>((n, k) => n?.[k], doc);

test("one OpenAPI document per service", () => expect(docs.map((d) => d.name)).toEqual(EXPECTED));

describe.each(docs)("$name", ({ doc }) => {
  test("valid OpenAPI 3.1", () => {
    expect(validateOas(doc) ? [] : validateOas.errors).toEqual([]);
  });

  test("version, health and version endpoints", () => {
    expect(doc.info.version).toBe(CONTRACTS_VERSION);
    expect(doc.paths["/healthz"]?.get).toBeDefined();
    expect(doc.paths["/version"]?.get).toBeDefined();
  });

  test("every $ref resolves (local pointer or contract schema)", () => {
    const broken = refs(doc).filter((r) => (r.startsWith("#/") ? pointer(doc, r) === undefined : !contracts.resolves(r)));
    expect(broken).toEqual([]);
  });

  test("operationIds are unique", () => {
    const ids = Object.values(doc.paths).flatMap((p: any) => Object.values(p).map((op: any) => op?.operationId).filter(Boolean));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
