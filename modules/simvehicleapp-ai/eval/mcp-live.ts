/**
 * MCP + tools on the real stack, no LLM (M10 review, 2026-10-07): an MCP client (SDK) calls every one of
 * the 13 SimVehicleApp tools through `ai-assistant /mcp` and checks the results against the real services
 * — VSS catalog, compiler, simulator, orchestrator (SynCode, Run), toolchain, KUKSA databroker — plus the
 * bearer and scope rules. Run by `mcp-live.sh` on the dev stack's sv-internal network.
 *
 * Env: SV_MCP_TOKEN_RO (scope tools), SV_MCP_TOKEN_AUTO (tools + actions:auto), INTERNAL_API_SECRET.
 */
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const AI = process.env.SV_AI_URL ?? "http://ai-assistant:4300";
const O = process.env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030";
const GOLDEN = "/repo/modules/simvehicleapp-contracts/fixtures/golden";
const internal = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
let failures = 0;
const check = (cond: unknown, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${msg}`);
  if (!cond) failures++;
};

type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
async function connect(token: string) {
  const client = new Client({ name: "mcp-live", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${AI}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as Result;
  return { client, call };
}
const text = (r: Result) => r.content.map((c) => c.text ?? "").join("\n");

const graphA = JSON.parse(readFileSync(`${GOLDEN}/GW-A/graph.json`, "utf8"));
const scenarioA = Bun.YAML.parse(readFileSync(`${GOLDEN}/GW-A/scenario.yaml`, "utf8"));
const writesA = JSON.parse(readFileSync(`${GOLDEN}/GW-A/expected.writes.json`, "utf8"));

// 1. bearer
for (const [label, auth] of [["no token", undefined], ["wrong token", "Bearer not-a-token-0000000000"]] as const) {
  const res = await fetch(`${AI}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check(res.status === 401, `${label} ⇒ 401 (${res.status})`);
}

const ro = await connect(process.env.SV_MCP_TOKEN_RO ?? "");
const auto = await connect(process.env.SV_MCP_TOKEN_AUTO ?? "");

// 2. tools/list: 13 tools, the 4 sensitive ones marked
const { tools } = await ro.client.listTools();
const names = tools.map((t) => t.name).sort();
check(names.length === 13, `13 tools listed: ${names.join(", ")}`);
const sensitive = tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name).sort();
check(JSON.stringify(sensitive) === JSON.stringify(["project_syncode", "run_start", "run_stop", "signal_set"]), `sensitive (destructiveHint, needs confirmation): ${sensitive.join(", ")}`);
check(tools.every((t) => t.inputSchema?.type === "object"), "every tool has an object input schema");

// 3. VSS
let r = await ro.call("vss_search", { query: "speed" });
check(!r.isError && text(r).includes("Vehicle.Speed — sensor float [km/h]"), "vss_search speed ⇒ Vehicle.Speed sensor float km/h");
r = await ro.call("vss_search", { query: "rear left door open" });
check(text(r).split("\n")[0]?.startsWith("Vehicle.Cabin.Door.Row2.DriverSide.IsOpen"), `vss_search "rear left door open" ⇒ Row2.DriverSide.IsOpen first (${text(r).split("\n")[0]})`);
r = await ro.call("vss_search", { query: "hazard", type: "actuator", release: "v4.2" });
check(text(r).includes("Vehicle.Body.Lights.Hazard.IsSignaling — actuator boolean"), "vss_search on VSS v4.2, type actuator");
r = await ro.call("vss_get_signal", { path: "Vehicle.Speed" });
check(!r.isError && /"datatype":"float"/.test(text(r)) && /"unit":"km\/h"/.test(text(r)), "vss_get_signal Vehicle.Speed ⇒ float km/h");
r = await ro.call("vss_get_signal", { path: "Vehicle.NoSuchSignal" });
check(r.isError === true && text(r).includes("is not a signal"), "vss_get_signal unknown path ⇒ tool error");

// 4. blocks, diagnostics
r = await ro.call("blocks_list");
const blockLines = text(r).split("\n").filter((l) => l.startsWith("- sv_"));
check(blockLines.length === 36 && text(r).includes("sv_stable_for"), `blocks_list ⇒ ${blockLines.length} vehicle blocks`);
r = await ro.call("diagnostics_explain", { diagnostic: "type_mismatch" });
check(!r.isError && text(r).startsWith("TYPE_MISMATCH (error"), `diagnostics_explain TYPE_MISMATCH: ${text(r).slice(0, 60)}`);
r = await ro.call("diagnostics_explain", { diagnostic: "NOPE" });
check(r.isError === true, "diagnostics_explain unknown code ⇒ tool error");

// 5. validate, simulate, propose without the editor (draftGraph)
r = await ro.call("workflow_validate", { draftGraph: graphA });
check(!r.isError && !((r.structuredContent?.diagnostics as { severity: string }[]) ?? []).some((d) => d.severity === "error"), "workflow_validate GW-A ⇒ no error");
const broken = { ...structuredClone(graphA), edges: [] };
r = await ro.call("workflow_validate", { draftGraph: broken });
check(((r.structuredContent?.diagnostics as { code: string }[]) ?? []).some((d) => d.code === "BLOCK_UNREACHABLE"), "workflow_validate GW-A without edges ⇒ BLOCK_UNREACHABLE");
r = await ro.call("workflow_validate", { draftGraph: { nope: 1 } });
check(r.isError === true, "workflow_validate malformed draftGraph ⇒ tool error");
r = await ro.call("workflow_simulate", { draftGraph: graphA, scenario: scenarioA });
check(JSON.stringify(r.structuredContent?.writes) === JSON.stringify(writesA), `workflow_simulate GW-A ⇒ the golden writes ${JSON.stringify(r.structuredContent?.writes)}`);
const empty = { graphVersion: "1.0.0", workflowId: "mcp_draft", revision: 0, name: "Draft", vss: { release: "v4.0" }, variables: [], blocks: [], edges: [] };
r = await ro.call("workflow_propose_patch", {
  draftGraph: empty,
  ops: [
    { op: "add_block", ref: "t1", type: "sv_on_signal_changed", name: "Speed changed", props: { path: "Vehicle.Speed", mode: "any" } },
    { op: "add_block", ref: "a1", type: "sv_set_actuator", name: "Hazard on", props: { path: "Vehicle.Body.Lights.Hazard.IsSignaling", value: "<speedchanged.value> > 120" } },
    { op: "connect", from: "t1", fromHandle: "source", to: "a1" },
  ],
});
check(r.structuredContent?.valid === true, `workflow_propose_patch on draftGraph ⇒ valid (${text(r).split("\n")[0]})`);
r = await ro.call("workflow_propose_patch", { draftGraph: empty, ops: [{ op: "add_block", ref: "x", type: "sv_set_actuator", props: { path: "Vehicle.Speed", value: "1" } }] });
check(r.structuredContent?.valid === false && /VEHICLE_WRITE_READ_ONLY|BLOCK_UNREACHABLE/.test(text(r)), "workflow_propose_patch writing a sensor ⇒ invalid with diagnostics");
r = await ro.call("workflow_get");
check(r.isError === true && text(r).includes("projectId"), "workflow_get without editor or projectId ⇒ explains projectId");

// 6. scopes: sensitive tools need actions:auto
for (const [name, args] of [["run_start", { projectId: "p" }], ["signal_set", { path: "Vehicle.Speed", value: 1 }], ["project_syncode", { projectId: "p" }], ["run_stop", { runId: "r" }]] as const) {
  r = await ro.call(name, args);
  check(r.isError === true && r.structuredContent?.error === "CONFIRMATION_REQUIRED", `${name} with the read-only token ⇒ CONFIRMATION_REQUIRED`);
}
r = await ro.call("no_such_tool");
check(r.isError === true, "unknown tool ⇒ tool error");

// 7. actions with actions:auto on a fresh project: SynCode (graphs), workflow_get, SynCode again (last), Run, inject, logs, Stop
const slug = `mcp-live-${Date.now()}`;
let p = await (await fetch(`${O}/projects`, { method: "POST", headers: internal, body: JSON.stringify({ slug, name: "MCP live", language: "cpp", vssRelease: "v4.0" }) })).json();
while (p.status === "creating") {
  await Bun.sleep(2000);
  p = await (await fetch(`${O}/projects/${p.id}`, { headers: internal })).json();
}
check(p.status === "ready", `project ${slug} ready`);
r = await auto.call("project_syncode", { projectId: p.id, graphs: [graphA] });
check(!r.isError && r.structuredContent?.success === true, `project_syncode with graphs ⇒ ${text(r).slice(0, 90)}`);
r = await auto.call("workflow_get", { projectId: p.id, workflowId: graphA.workflowId });
check(!r.isError && JSON.parse(text(r)).workflowId === graphA.workflowId, "workflow_get projectId ⇒ the graph of the last SynCode");
r = await auto.call("project_syncode", { projectId: p.id });
check(!r.isError && r.structuredContent?.success === true, "project_syncode without graphs ⇒ SynCode again with the last workflows");
r = await auto.call("run_start", { projectId: p.id });
const runId = r.structuredContent?.runId as string;
check(!r.isError && typeof runId === "string", `run_start ⇒ ${text(r)}`);
for (let i = 0; i < 60; i++) {
  const run = await (await fetch(`${O}/runs/${runId}`, { headers: internal })).json();
  if (run.state === "running") break;
  await Bun.sleep(500);
}
r = await auto.call("signal_set", { projectId: p.id, path: "Vehicle.Speed", value: 130 });
check(!r.isError && text(r).includes("on VSS v4.0"), `signal_set (release from the project) ⇒ ${text(r)}`);
r = await auto.call("signal_set", { path: "Vehicle.Speed", value: "fast", release: "v4.0" });
check(r.isError === true, `signal_set a string on a float signal ⇒ tool error from the gateway (${text(r).slice(0, 80)})`);
r = await auto.call("signal_set", { path: "Vehicle.NoSuchSignal", value: 1, release: "v4.0" });
check(r.isError === true, "signal_set unknown path ⇒ tool error");
await Bun.sleep(1500);
r = await auto.call("run_logs", { runId, filter: "app.started" });
check(!r.isError && text(r).includes("app.started"), "run_logs ⇒ app.started");
r = await auto.call("run_logs", { runId: "r_no_such_run" });
check(r.isError === true || text(r) === "(no events)", "run_logs unknown run ⇒ error or no events");
r = await auto.call("run_stop", { runId });
check(!r.isError && /stopping|stopped/.test(text(r)), `run_stop ⇒ ${text(r)}`);

await ro.client.close();
await auto.client.close();
console.log(`\nMCP live: ${failures ? `FAIL (${failures})` : "PASS"} — project ${slug}`);
process.exit(failures ? 1 : 0);
