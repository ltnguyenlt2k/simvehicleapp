/**
 * Golden simulation outputs (M05-T11, ADR-0042): `expected.writes.json` and `expected.trace.json` of
 * every golden workflow, produced by the simulator from the golden `ir.json` and `scenario.yaml`.
 * Generated, never hand-edited; the first version was reviewed (docs/reviews/M05-golden-trace-review.md).
 * The runtimes (M6+) must reproduce them (parity).
 *
 *   bun packages/simulator/src/golden-trace.ts           # check (exit 1 when a file differs)
 *   bun packages/simulator/src/golden-trace.ts --write   # regenerate into the contracts module
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixturesDir } from "@simvehicleapp/contracts";
import { simulate } from "./simulator.ts";

export const GOLDEN_RUN_ID = "golden";

export const goldenIds = () =>
  readdirSync(`${fixturesDir}golden`, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("GW-"))
    .map((d) => d.name)
    .sort();

export function goldenOutputs(id: string): { writes: string; trace: string } {
  const ir = JSON.parse(readFileSync(`${fixturesDir}golden/${id}/ir.json`, "utf8"));
  const sc = Bun.YAML.parse(readFileSync(`${fixturesDir}golden/${id}/scenario.yaml`, "utf8")) as {
    until: number;
    initial?: Record<string, unknown>;
    inputs: never[];
    latency?: { read?: number; write?: number };
  };
  const r = simulate(ir, { until: sc.until, initial: sc.initial, inputs: sc.inputs, latency: sc.latency, runId: GOLDEN_RUN_ID });
  return { writes: `${JSON.stringify(r.writes, null, 2)}\n`, trace: `${JSON.stringify(r.trace, null, 2)}\n` };
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  let failed = 0;
  for (const id of goldenIds()) {
    const out = goldenOutputs(id);
    for (const [name, text] of [["expected.writes.json", out.writes], ["expected.trace.json", out.trace]] as const) {
      if (write) {
        writeFileSync(fileURLToPath(new URL(`../../../../simvehicleapp-contracts/fixtures/golden/${id}/${name}`, import.meta.url)), text);
        continue;
      }
      let have = "";
      try {
        have = readFileSync(`${fixturesDir}golden/${id}/${name}`, "utf8");
      } catch {}
      if (have !== text) {
        console.log(`golden-trace: ${id}/${name} differs — run with --write and review the diff`);
        failed++;
      }
    }
  }
  console.log(`golden-trace: ${failed ? "FAIL" : write ? "WROTE" : "PASS"}`);
  process.exit(failed ? 1 : 0);
}
