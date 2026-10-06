import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { ContractValidator, fixturesDir, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { parseVssRelease, type VssModel } from "@simvehicleapp/vss";
import { goldenIr, irFixtureDirs } from "./golden-ir.ts";
import { type CompileContext, compile, kebab, pascal } from "./index.ts";

const fixture = (rel: string) => `${fixturesDir}${rel}`;
const models: Record<string, VssModel> = {
  "v4.0": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.0.json"), "utf8")), "v4.0"),
  "v4.2": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.2.json"), "utf8")), "v4.2"),
};
export const ctx: CompileContext = {
  vehicle: async (release, paths) => new Map(paths.map((p) => [p, models[release]!.nodes.get(p) ?? null])),
  modelHash: async (release) => models[release]?.modelHash ?? null,
};
const corpus = (dir: string) =>
  readdirSync(fixture(dir), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => [`${dir}/${d.name}`, JSON.parse(readFileSync(fixture(`${dir}/${d.name}/graph.json`), "utf8")) as WorkflowGraphV1] as const)
    .sort();
const validator = new ContractValidator();

describe("compile: every golden and conformance graph builds a valid IR (M04-T08)", () => {
  for (const [id, graph] of [...corpus("golden"), ...corpus("conformance")]) {
    test(`${id}`, async () => {
      const r = await compile(graph, ctx);
      expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(r.ir).toBeDefined();
      const v = validator.validate("ir", r.ir);
      expect(v.errors).toEqual([]);
      // deterministic: same graph ⇒ same bytes
      expect(JSON.stringify((await compile(structuredClone(graph), ctx)).ir)).toBe(JSON.stringify(r.ir));
    });
  }
});

describe("compile: names", () => {
  test("PascalCase IR name and kebab-case app topic", () => {
    expect(pascal("Stable Overspeed Warning")).toBe("StableOverspeedWarning");
    expect(pascal("auto wipers 2")).toBe("AutoWipers2");
    expect(pascal("2 doors")).toBe("App2Doors");
    expect(pascal("—")).toBe("App");
    expect(kebab("Stable Overspeed Warning")).toBe("stable-overspeed-warning");
    expect(kebab("WelcomeSequence")).toBe("welcome-sequence");
  });
});

describe("golden IR snapshots (ADR-0014 Verification: diff = 0)", () => {
  for (const dir of irFixtureDirs()) {
    test(`${dir}/ir.json is what the compiler produces`, async () => {
      expect(await goldenIr(dir)).toBe(readFileSync(fixture(`${dir}/ir.json`), "utf8"));
    });
  }
});
