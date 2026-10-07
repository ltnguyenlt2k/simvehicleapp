/**
 * M10 gate (analysis/phases/M10): the prompt "Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy" on an empty
 * workflow ⇒ a valid patch equivalent to GW-B, with the real provider configured in the stack. Equivalence
 * is behavioural: simulated with GW-B's scenario, the proposal notifies the HMI exactly when GW-B does.
 * Also: run_start needs a confirmation (pending action, nothing runs before it).
 */
import { readFileSync } from "node:fs";
import { chat } from "./chat.ts";

const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const C = "http://compiler:4020";
const dir = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-B/";
const must = (c: unknown, m: string) => {
  if (!c) {
    console.error(`FAIL ${m}`);
    process.exit(1);
  }
  console.log(`ok ${m}`);
};
const hmiTimes = async (graph: unknown, scenario: unknown) => {
  const b = (await (await fetch(`${C}/compile`, { method: "POST", headers: h, body: JSON.stringify({ graph, mode: "build" }) })).json()) as { ir?: unknown };
  if (!b.ir) return null;
  const s = (await (await fetch(`${C}/simulate`, { method: "POST", headers: h, body: JSON.stringify({ ir: b.ir, scenario }) })).json()) as { publishes: { t: number; topic: string }[] };
  return s.publishes.filter((p) => p.topic.endsWith("/hmi")).map((p) => p.t);
};

const status = (await (await fetch("http://ai-assistant:4300/status", { headers: { ...h, "x-sv-user-id": "gate" } })).json()) as { configured: boolean; provider?: string; model?: string };
must(status.configured, `provider ${status.provider} / ${status.model}`);
const scenario = Bun.YAML.parse(readFileSync(`${dir}scenario.yaml`, "utf8")) as Record<string, unknown>;
const golden = await hmiTimes(JSON.parse(readFileSync(`${dir}graph.json`, "utf8")), scenario);
must(golden?.length, `GW-B notifies the HMI at ${JSON.stringify(golden)} in its scenario`);

const attempts = Number(process.env.SV_GATE_ATTEMPTS ?? 3);
let passed = 0;
for (let i = 1; i <= attempts; i++) {
  const r = await chat("Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy", { user: `gate-${i}` });
  const p = r.proposal;
  const times = p?.valid ? await hmiTimes(p.graph, scenario) : null;
  const ok = Boolean(p?.valid && times && JSON.stringify(times) === JSON.stringify(golden));
  console.log(`  attempt ${i}: ${(r.ms / 1000).toFixed(0)} s, ${p ? (p.valid ? "valid" : "invalid") : "no proposal"}, HMI at ${JSON.stringify(times)} — ${p?.graph.blocks.map((b) => b.type).join(" → ") ?? r.text.slice(0, 120)}`);
  if (ok) passed++;
}
must(passed >= 1, `${passed}/${attempts} attempts: a valid patch that behaves like GW-B (HMI warning only when the battery is low while moving)`);

const r = await chat("Run the project now.", { user: "gate-run", projectId: "p_gate" });
must(r.pending?.toolName === "run_start", `run_start waits for a confirmation (pending action ${JSON.stringify(r.pending?.toolInput ?? null)})`);
