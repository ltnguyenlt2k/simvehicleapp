import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { compile } from "@simvehicleapp/compiler";
import { fixtureContext } from "@simvehicleapp/compiler/src/golden-ir.ts";
import { fixturesDir } from "@simvehicleapp/contracts";
import { goldenIds, goldenOutputs } from "./golden-trace.ts";
import { checkExpectations, simulate } from "./index.ts";

/**
 * ADR-0017 Verification / M5 gate: every conformance case (executable spec of ADR-0012) and every
 * golden scenario passes on the simulator, compiled by the real compiler.
 */
const ctx = fixtureContext();
const cases = (dir: string) =>
  readdirSync(`${fixturesDir}${dir}`, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `${dir}/${d.name}`)
    .sort();

async function run(id: string) {
  const graph = JSON.parse(readFileSync(`${fixturesDir}${id}/graph.json`, "utf8"));
  const scenario = Bun.YAML.parse(readFileSync(`${fixturesDir}${id}/scenario.yaml`, "utf8")) as {
    until: number;
    initial?: Record<string, unknown>;
    inputs: { t: number; path?: string; topic?: string; value: unknown }[];
    expect?: { writes?: { t: number; path: string; value: unknown }[]; trace?: Record<string, unknown>[] };
  };
  const { ir, diagnostics } = await compile(graph, ctx);
  if (!ir) throw new Error(`${id}: ${diagnostics.map((d) => d.code).join(", ")}`);
  const result = simulate(ir, { until: scenario.until, initial: scenario.initial, inputs: scenario.inputs });
  return { result, mismatches: checkExpectations(result, scenario.expect) };
}

describe("conformance C01…C38 on the simulator (M5 gate)", () => {
  for (const id of cases("conformance")) {
    test(id, async () => {
      const { mismatches } = await run(id);
      expect(mismatches.map((m) => m.message)).toEqual([]);
    });
  }
});

describe("golden scenarios GW-A…GW-G on the simulator", () => {
  for (const id of cases("golden")) {
    test(id, async () => {
      const { mismatches } = await run(id);
      expect(mismatches.map((m) => m.message)).toEqual([]);
    });
  }
});

describe("frozen golden outputs (M05-T11): expected.writes.json / expected.trace.json", () => {
  for (const id of goldenIds()) {
    test(`${id}`, () => {
      const out = goldenOutputs(id);
      expect(out.writes).toBe(readFileSync(`${fixturesDir}golden/${id}/expected.writes.json`, "utf8"));
      expect(out.trace).toBe(readFileSync(`${fixturesDir}golden/${id}/expected.trace.json`, "utf8"));
    });
  }
});
