/**
 * Golden IR snapshots (M04-T08, ADR-0014 Verification): `ir.json` of every golden workflow in
 * contracts `fixtures/golden/GW-*`, compiled against the bundled VSS fixtures. Generated, never
 * hand-edited; the first version was reviewed by hand (docs/reviews/M04-golden-ir-review.md).
 * The conformance cases `fixtures/conformance/C*` get their `ir.json` the same way (M06): every
 * backend runs them without depending on the compiler (ADR-0042 P1).
 *
 *   bun packages/compiler/src/golden-ir.ts           # check (exit 1 when a snapshot differs)
 *   bun packages/compiler/src/golden-ir.ts --write   # regenerate the snapshots
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixturesDir, type WorkflowGraphV1 } from "@simvehicleapp/contracts";
import { parseVssRelease, type VssModel } from "@simvehicleapp/vss";
import { type CompileContext, compile } from "./compile.ts";

const fixture = (rel: string) => `${fixturesDir}${rel}`;

export function fixtureContext(): CompileContext {
  const models: Record<string, VssModel> = {
    "v4.0": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.0.json"), "utf8")), "v4.0"),
    "v4.2": parseVssRelease(JSON.parse(readFileSync(fixture("vss/vss_rel_4.2.json"), "utf8")), "v4.2"),
  };
  return {
    vehicle: async (release, paths) => new Map(paths.map((p) => [p, models[release]?.nodes.get(p) ?? null])),
    modelHash: async (release) => models[release]?.modelHash ?? null,
  };
}

export const goldenIds = () =>
  readdirSync(fixture("golden"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("GW-"))
    .map((d) => d.name)
    .sort();

export const conformanceIds = () =>
  readdirSync(fixture("conformance"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^C[0-9]+-/.test(d.name))
    .map((d) => d.name)
    .sort();

/** Fixture directories with an `ir.json` snapshot, relative to `fixtures/`. */
export const irFixtureDirs = () => [...goldenIds().map((id) => `golden/${id}`), ...conformanceIds().map((id) => `conformance/${id}`)];

/** `id` is a golden id (`GW-A`) or a fixture directory (`conformance/C01-any-change`). */
export async function goldenIr(id: string, ctx = fixtureContext()): Promise<string> {
  const dir = id.includes("/") ? id : `golden/${id}`;
  const graph = JSON.parse(readFileSync(fixture(`${dir}/graph.json`), "utf8")) as WorkflowGraphV1;
  const r = await compile(graph, ctx);
  if (!r.ir) throw new Error(`${id} does not compile: ${r.diagnostics.map((d) => d.code).join(", ")}`);
  return `${JSON.stringify(r.ir, null, 2)}\n`;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  let failed = 0;
  for (const dir of irFixtureDirs()) {
    const want = await goldenIr(dir);
    // Write into the contracts module itself: `fixturesDir` is bun's copy in node_modules
    // (`bun install` afterwards refreshes it for the tests).
    const source = fileURLToPath(new URL(`../../../../simvehicleapp-contracts/fixtures/${dir}/ir.json`, import.meta.url));
    const path = write ? source : fixture(`${dir}/ir.json`);
    if (write) writeFileSync(path, want);
    else {
      let have = "";
      try {
        have = readFileSync(path, "utf8");
      } catch {}
      if (have !== want) {
        console.log(`golden-ir: ${dir}/ir.json differs — run with --write and review the diff`);
        failed++;
      }
    }
  }
  console.log(`golden-ir: ${failed ? "FAIL" : write ? "WROTE" : "PASS"}`);
  process.exit(failed ? 1 : 0);
}
