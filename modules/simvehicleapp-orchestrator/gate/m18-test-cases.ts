/**
 * M18-T02/T03 gate (ADR-0058 §2/§9), run by `m18-test-cases.sh` on sv-internal: real orchestrator, backends and
 * toolchains. GW-A with three cases per backend ⇒ SynCode passes, and the generation log names the three tests.
 */
import { readFileSync } from "node:fs";

const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
const slug = process.env.SLUG ?? "";
const langs = (process.env.LANGS ?? "cpp,python,rust").split(",").filter(Boolean);
const golden = "/repo/modules/simvehicleapp-contracts/fixtures/golden/GW-A";

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const get = async (url: string) => (await fetch(url, { headers: h })).json();
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });

const graph = JSON.parse(readFileSync(`${golden}/graph.json`, "utf8"));
const scenario = Bun.YAML.parse(readFileSync(`${golden}/scenario.yaml`, "utf8")) as Record<string, unknown>;
const below = { scenarioVersion: "1.1.0", name: "Below the limit", until: 4000, inputs: [{ t: 0, path: "Vehicle.Speed", value: 100 }], expect: { never: [{ path: "Vehicle.Body.Lights.Hazard.IsSignaling" }] } };
// The same case broken on purpose would fail: a 1.1 expectation the app does not meet.
const cases = [
  { workflowId: graph.workflowId, scenario, caseName: "Overspeed held 2 s" },
  { workflowId: graph.workflowId, scenario: below, caseName: "Below the limit" },
  { workflowId: graph.workflowId, scenario, caseName: "Overspeed held 2 s" },
];
const names: Record<string, string[]> = {
  cpp: ["OverspeedHeld2S", "BelowTheLimit", "OverspeedHeld2S2"],
  python: ["overspeed_held_2_s", "below_the_limit", "overspeed_held_2_s_2"],
  rust: ["overspeed_held_2_s", "below_the_limit", "overspeed_held_2_s_2"],
};

for (const language of langs) {
  let p = await (await post(`${O}/projects`, { slug: `${slug}-${language}`, name: `Gate M18 ${language}`, language, vssRelease: "v4.0" })).json();
  const t0 = Date.now();
  while (p.status === "creating" && Date.now() - t0 < 600_000) {
    await Bun.sleep(2000);
    p = await get(`${O}/projects/${p.id}`);
  }
  must(p.status === "ready", `${language}: app ${p.slug} ready`);
  const queued = await (await post(`${O}/projects/${p.id}/generations`, { graphs: [graph], scenarios: cases })).json();
  const log = await (await fetch(`${O}/events?generationId=${queued.id}`, { headers: h })).text();
  const gen = await get(`${O}/projects/${p.id}/generations/${queued.id}`);
  must(gen.success && gen.verification?.tests === "passed", `${language}: SynCode with 3 test cases ${JSON.stringify(gen.verification)}`);
  for (const n of names[language] ?? []) must(log.includes(n), `${language}: generated test ${n} ran`);
}
