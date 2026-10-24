/**
 * Test-writing eval (M18-T06, ADR-0058 §8): "test this workflow" on each golden workflow GW-A…G with the
 * provider configured in the stack. A workflow passes when the assistant ends the turn with scenario_propose
 * holding at least two valid test cases (schema 1.1, simulated on the workflow). Reports how many proposed
 * cases the workflow meets. Target ≥ 80 % of the workflows. `--json` writes the details.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { chat } from "./chat.ts";

const GOLDEN = "/repo/modules/simvehicleapp-contracts/fixtures/golden";
const WORKFLOWS = ["GW-A", "GW-B", "GW-C", "GW-D", "GW-E", "GW-F", "GW-G"];
const PROMPTS = [
  "Test this workflow: propose test cases that cover its branches.",
  "Viết test case cho workflow này, phủ các nhánh.",
];

const results: { workflow: string; prompt: string; pass: boolean; seconds: number; cases: number; meets: number; invalid: number; note?: string }[] = [];
for (const [i, wf] of WORKFLOWS.entries()) {
  const graph = JSON.parse(readFileSync(`${GOLDEN}/${wf}/graph.json`, "utf8")) as { workflowId: string };
  const prompt = PROMPTS[i % PROMPTS.length]!;
  const r = await chat(prompt, { user: `tests-eval-${i}`, workflowId: graph.workflowId, graph });
  const p = r.testProposal;
  const valid = p?.results.filter((x) => x.valid) ?? [];
  const x = {
    workflow: wf,
    prompt,
    pass: valid.length >= 2,
    seconds: Math.round(r.ms / 1000),
    cases: valid.length,
    meets: valid.filter((c) => c.passed).length,
    invalid: (p?.results.length ?? 0) - valid.length,
    ...(p ? {} : { note: r.error ?? (r.text.slice(0, 160) || r.tools.join("; ").slice(0, 160)) }),
  };
  results.push(x);
  console.log(`${wf} ${x.pass ? "PASS" : "FAIL"} ${String(x.seconds).padStart(3)} s  ${x.cases} case(s), workflow meets ${x.meets}, invalid ${x.invalid}${x.note ? `  — ${x.note}` : ""}`);
}
const passed = results.filter((r) => r.pass).length;
console.log(`\nworkflows with ≥ 2 valid test cases: ${passed}/${results.length} = ${Math.round((100 * passed) / results.length)} %`);
if (process.argv.includes("--json")) writeFileSync("/out/m18-tests-eval.json", JSON.stringify({ results, passed, total: results.length }, null, 2));
process.exit(passed / results.length >= 0.8 ? 0 : 1);
