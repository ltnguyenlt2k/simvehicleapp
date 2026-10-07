import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fixturesDir } from "@simvehicleapp/contracts";
import { normalizeHistory } from "./agent.ts";
import { createAssistantHandler, type Entitlement, entitlementFrom, RateLimiter } from "./app.ts";
import { connectExternal, createMcpHandler, extName } from "./mcp.ts";
import { applyPatch, emptyGraph, normalizeName, type WorkflowGraph } from "./patch.ts";
import { anthropicProvider } from "./providers/anthropic.ts";
import { geminiProvider, geminiSchema } from "./providers/gemini.ts";
import { openaiProvider, toOpenAi } from "./providers/openai.ts";
import type { LlmProvider, Message, TurnRequest, TurnResult } from "./providers/types.ts";
import type { Services } from "./services.ts";
import { MemoryStore } from "./store.ts";
import { BlockCatalog, createTools, SAFE_TOOL_NAMES, SENSITIVE_TOOL_NAMES } from "./tools.ts";

const servers: { stop(force?: boolean): void }[] = [];
afterAll(() => servers.forEach((s) => s.stop(true)));
const serve = (fetch: (req: Request) => Response | Promise<Response>) => {
  const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
  servers.push(s);
  return `http://127.0.0.1:${s.port}`;
};
const sseBody = (events: unknown[], named = false) =>
  new Response(events.map((e) => (named ? `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n` : `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)).join(""), { headers: { "content-type": "text/event-stream" } });
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;

describe("providers (M10-T02): streaming + tool calls, canonical Anthropic blocks", () => {
  test("anthropic: text and tool_use with streamed JSON input", async () => {
    let body: Record<string, unknown> = {};
    const base = serve(async (req) => {
      body = (await req.json()) as Record<string, unknown>;
      expect(req.headers.get("x-api-key")).toBe("k");
      return sseBody(
        [
          { type: "message_start" },
          { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Looking" } },
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "vss_search" } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } },
          { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"speed"}' } },
          { type: "message_delta", delta: { stop_reason: "tool_use" } },
        ],
        true,
      );
    });
    const deltas: string[] = [];
    const r = await anthropicProvider({ apiKey: "k", model: "m", baseUrl: base }).streamTurn({ system: "s", tools: [], messages: [{ role: "user", content: "hi" }], onText: (d) => deltas.push(d) });
    expect(r).toEqual({ content: [{ type: "text", text: "Looking" }, { type: "tool_use", id: "tu1", name: "vss_search", input: { query: "speed" } }], stopReason: "tool_use" });
    expect(deltas).toEqual(["Looking"]);
    expect(body).toMatchObject({ model: "m", system: "s", stream: true });
  });

  test("openai-compatible (Ollama too): tool_calls assembled from deltas; history translated", async () => {
    let body: { messages: unknown[]; tools?: unknown[]; reasoning_effort?: string } = { messages: [] };
    const base = serve(async (req) => {
      body = (await req.json()) as typeof body;
      return sseBody([
        { choices: [{ delta: { content: "Ok " } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "vss_", arguments: '{"que' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: 'ry":"soc"}' } }] }, finish_reason: "tool_calls" }] },
        "[DONE]",
      ]);
    });
    const p = openaiProvider({ name: "ollama", model: "qwen", baseUrl: base, extraBody: { reasoning_effort: "none" } });
    const history: Message[] = [
      { role: "user", content: "find soc" },
      { role: "assistant", content: [{ type: "text", text: "searching" }, { type: "tool_use", id: "a", name: "vss_search", input: { query: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: "nothing", is_error: true }] },
    ];
    const r = await p.streamTurn({ system: "s", tools: [{ name: "vss_search", description: "d", input_schema: { type: "object" } }], messages: history });
    expect(r).toEqual({ content: [{ type: "text", text: "Ok " }, { type: "tool_use", id: "c1", name: "vss_search", input: { query: "soc" } }], stopReason: "tool_use" });
    expect(body.reasoning_effort).toBe("none");
    expect(body.messages).toEqual([
      { role: "system", content: "s" },
      { role: "user", content: "find soc" },
      { role: "assistant", content: "searching", tool_calls: [{ id: "a", type: "function", function: { name: "vss_search", arguments: '{"query":"x"}' } }] },
      { role: "tool", tool_call_id: "a", content: "ERROR: nothing" },
    ]);
    expect(toOpenAi([{ role: "user", content: "x" }])).toEqual([{ role: "user", content: "x" }]);
  });

  test("gemini: native API with x-goog-api-key, functionCall parts, schema keywords Gemini rejects are dropped", async () => {
    let seen: { path: string; key: string | null; body: Record<string, any> } = { path: "", key: null, body: {} };
    const base = serve(async (req) => {
      seen = { path: new URL(req.url).pathname + new URL(req.url).search, key: req.headers.get("x-goog-api-key"), body: (await req.json()) as Record<string, any> };
      return sseBody([{ candidates: [{ content: { parts: [{ text: "Hi" }, { functionCall: { name: "blocks_list", args: {} } }] } }] }]);
    });
    const r = await geminiProvider({ apiKey: "AQ.key", model: "g", baseUrl: base }).streamTurn({ system: "s", tools: [{ name: "blocks_list", description: "d", input_schema: { type: "object", additionalProperties: false, properties: {} } }], messages: [{ role: "user", content: "hi" }] });
    expect(seen.path).toBe("/models/g:streamGenerateContent?alt=sse");
    expect(seen.key).toBe("AQ.key");
    expect(seen.body.tools[0].functionDeclarations[0].parameters).toEqual({ type: "object", properties: {} });
    expect(r.content[1]).toMatchObject({ type: "tool_use", name: "blocks_list" });
    expect(geminiSchema({ a: { pattern: "x", type: "string" } })).toEqual({ a: { type: "string" } });
  });
});

describe("WorkflowPatch v1 (M10-T05)", () => {
  const base = (): WorkflowGraph => ({ ...emptyGraph("wf", "W", "v4.0"), blocks: [{ id: "b1", type: "sv_on_app_start", name: "Start", props: {} }], edges: [] });
  test("ops apply in order on a copy; refs become ids; names are unique; problems are reported", () => {
    const g = base();
    const { graph, problems } = applyPatch(g, [
      { op: "add_block", ref: "c1", type: "sv_if", props: { condition: "true" } },
      { op: "add_block", ref: "c2", type: "sv_if", props: { condition: "false" } },
      { op: "connect", from: "b1", fromHandle: "source", to: "c1" },
      { op: "set_props", block: "c1", props: { condition: "1 > 0" } },
      { op: "connect", from: "c1", fromHandle: "then", to: "zz" },
      { op: "add_block", ref: "b1", type: "sv_if", props: {} },
    ], (t) => (t === "sv_if" ? "If" : t));
    expect(g.blocks).toHaveLength(1);
    expect(graph.blocks.map((b) => [b.id, b.name])).toEqual([["b1", "Start"], ["c1", "If"], ["c2", "If 2"]]);
    expect(graph.blocks[1]!.props).toEqual({ condition: "1 > 0" });
    expect(graph.edges).toEqual([{ id: "e1", from: "b1", fromHandle: "source", to: "c1", toHandle: "target" }]);
    expect(problems).toEqual(["ops[4] connect: block zz does not exist", "ops[5] add_block: block b1 already exists — use another ref, or set_props to change it"]);
  });
  test("removing a container removes its content and their edges", () => {
    const { graph } = applyPatch(base(), [
      { op: "add_block", ref: "p", type: "sv_parallel", props: {} },
      { op: "add_block", ref: "x", type: "sv_log", props: {}, parentId: "p" },
      { op: "connect", from: "b1", fromHandle: "source", to: "p" },
      { op: "remove_block", block: "p" },
    ]);
    expect(graph.blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(graph.edges).toEqual([]);
    expect(normalizeName("SoC changed.v2")).toBe("socchangedv2");
  });

  test("new edge ids never repeat an existing one (after a removal)", () => {
    // An earlier proposal left e2 alone (e1 was removed on the canvas): one edge, so a counter would say e2.
    const start: WorkflowGraph = { ...base(), blocks: [...base().blocks, { id: "y", type: "sv_log", name: "Log", props: {} }], edges: [{ id: "e2", from: "b1", fromHandle: "source", to: "y", toHandle: "target" }] };
    const { graph } = applyPatch(start, [
      { op: "add_block", ref: "z", type: "sv_log", props: {} },
      { op: "connect", from: "y", fromHandle: "source", to: "z" },
    ]);
    const ids = graph.edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/** LLM that plays a script: each call returns the next turn, recording what it was sent. */
function scripted(turns: TurnResult[]): LlmProvider & { calls: TurnRequest[] } {
  const calls: TurnRequest[] = [];
  return {
    name: "scripted",
    model: "script",
    calls,
    async streamTurn(req) {
      calls.push(structuredClone({ ...req, onText: undefined, signal: undefined }));
      const next = turns.shift() ?? { content: [{ type: "text", text: "(end)" }], stopReason: "end_turn" };
      for (const b of next.content) if (b.type === "text") req.onText?.(b.text);
      return next;
    },
  };
}

/** Fake compiler/catalog/orchestrator/gateway behind the Services interface. */
function fakeServices(log: string[] = []): Services {
  return {
    async get(service, path) {
      log.push(`GET ${service} ${path}`);
      if (service === "compiler" && path === "/blocks") return { blocks: [{ type: "sv_if", title: "If", category: "flow", props: [{ name: "condition", kind: "expression", required: true }], outputs: [], handles: { in: ["target"], out: ["then", "else"] } }] };
      if (service === "catalog") return { nodes: [{ path: "Vehicle.Speed", kind: "sensor", datatype: "float", unit: "km/h", description: "Vehicle speed." }] };
      if (service === "orchestrator" && path.startsWith("/projects/")) return { editor: { url: "http://ide/?folder=x" } };
      return {};
    },
    async post(service, path, body) {
      log.push(`POST ${service} ${path} ${JSON.stringify(body).slice(0, 80)}`);
      if (service === "compiler" && path === "/compile") {
        const g = (body as { graph: WorkflowGraph }).graph;
        const bad = g.blocks.find((b) => b.type === "sv_if" && !b.props.condition);
        return { diagnostics: bad ? [{ code: "PROP_REQUIRED", severity: "error", message: "condition is required", blockId: bad.id }] : [] };
      }
      if (service === "orchestrator" && path.endsWith("/runs")) return { id: "r_1", state: "starting" };
      if (service === "signalGateway") return { ...(body as object), ts: 5 };
      return {};
    },
    async raw() {
      return new Response("");
    },
  };
}

const graph0 = (): WorkflowGraph => ({ ...emptyGraph("wf1", "Comfort", "v4.0"), blocks: [{ id: "b1", type: "sv_on_app_start", name: "Start", props: {} }] });
const turnCtx = { workflow: { workflowId: "wf1", name: "Comfort", vssRelease: "v4.0", graph: graph0() }, project: { id: "p1", vssRelease: "v4.0" } };

async function chatApp(turns: TurnResult[], opts: { rate?: number; entitled?: () => Promise<Entitlement> } = {}) {
  const store = new MemoryStore();
  const log: string[] = [];
  const services = fakeServices(log);
  const blocks = new BlockCatalog(services);
  const provider = scripted(turns);
  let n = 0;
  const h = createAssistantHandler({ provider, store, tools: createTools(services, blocks), blocks, external: [], maxSteps: 6, ratePerMinute: opts.rate ?? 20, pendingTtlMs: 60_000, newId: () => `id${++n}`, ...(opts.entitled ? { entitled: opts.entitled } : {}) });
  const call = async (path: string, body: unknown, user = "u1") => h(new Request(`http://ai${path}`, { method: "POST", headers: { "x-sv-user-id": user, "content-type": "application/json" }, body: JSON.stringify(body) }), ctx);
  const events = async (res: Response) =>
    (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((b) => ({ event: /^event: (.+)$/m.exec(b)![1]!, data: JSON.parse(/^data: (.+)$/m.exec(b)![1]!) }));
  return { store, log, provider, call, events, h };
}

describe("agent loop + /chat (M10-T04, ADR-0030 §6 verification)", () => {
  test("safe tools run in the turn; a proposal is validated and streamed; text streams", async () => {
    const app = await chatApp([
      { content: [{ type: "tool_use", id: "t1", name: "vss_search", input: { query: "speed" } }], stopReason: "tool_use" },
      { content: [{ type: "tool_use", id: "t2", name: "workflow_propose_patch", input: { ops: [{ op: "add_block", ref: "c1", type: "sv_if", props: {} }, { op: "connect", from: "b1", fromHandle: "source", to: "c1" }] } }], stopReason: "tool_use" },
      { content: [{ type: "tool_use", id: "t3", name: "workflow_propose_patch", input: { ops: [{ op: "add_block", ref: "c1", type: "sv_if", props: { condition: "<Vehicle.Speed> > 100" } }, { op: "connect", from: "b1", fromHandle: "source", to: "c1" }] } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Added a check." }], stopReason: "end_turn" },
    ]);
    const ev = await app.events(await app.call("/chat", { message: "check speed", context: turnCtx }));
    expect(ev.filter((e) => e.event === "tool").map((e) => e.data.name)).toEqual(["vss_search", "workflow_propose_patch", "workflow_propose_patch"]);
    expect(ev.find((e) => e.event === "tool_result" && e.data.id === "t2")!.data.text).toContain("PROP_REQUIRED");
    const proposals = ev.filter((e) => e.event === "proposal");
    expect(proposals).toHaveLength(1); // the latest, at the end of the turn
    expect(proposals[0]!.data).toMatchObject({ valid: true, patch: { patchVersion: "1.0.0", workflowId: "wf1" }, summary: { added: [{ id: "c1", name: "If" }] } });
    expect(ev.at(-1)).toMatchObject({ event: "done", data: { pending: false, steps: 4 } });
    expect(ev.filter((e) => e.event === "text").map((e) => e.data.delta).join("")).toBe("Added a check.");
    // the LLM saw the tool result of the failed proposal
    expect(JSON.stringify(app.provider.calls[2]!.messages)).toContain("PROP_REQUIRED");
    expect(app.provider.calls[0]!.system).toContain("sv_if — If");
  });

  test("a sensitive tool missing a required field is a tool error in the same turn, never a pending action", async () => {
    const app = await chatApp([
      { content: [{ type: "text", text: "Which signal?" }, { type: "tool_use", id: "s1", name: "signal_set", input: { value: 130 } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Which signal do you mean?" }], stopReason: "end_turn" },
    ]);
    const ev = await app.events(await app.call("/chat", { message: "set it to 130", context: turnCtx }));
    expect(ev.some((e) => e.event === "pending_action")).toBe(false);
    expect(JSON.stringify(app.provider.calls[1]!.messages)).toContain("Missing required field(s): path");
    const conv = ev.at(-1)!.data.conversationId as string;
    expect(await app.store.pending(conv)).toBeNull();
  });

  test("a complete sensitive call waits for confirmation; new messages get 409; the edited input wins; cancel answers the LLM", async () => {
    const app = await chatApp([
      { content: [{ type: "tool_use", id: "r1", name: "run_start", input: { projectId: "p1" } }, { type: "tool_use", id: "s2", name: "signal_set", input: { path: "Vehicle.Speed", value: 1 } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Running." }], stopReason: "end_turn" },
      { content: [{ type: "tool_use", id: "s3", name: "signal_set", input: { path: "Vehicle.Speed", value: 50 } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Fine, not set." }], stopReason: "end_turn" },
    ]);
    const ev = await app.events(await app.call("/chat", { message: "run it", context: turnCtx }));
    const pending = ev.find((e) => e.event === "pending_action")!;
    expect(pending.data).toMatchObject({ toolName: "run_start", toolInput: { projectId: "p1" } });
    expect(ev.at(-1)).toMatchObject({ event: "done", data: { pending: true } });
    expect(app.log.some((l) => l.includes("/runs"))).toBe(false); // nothing ran yet
    const conv = ev.at(-1)!.data.conversationId as string;
    const busy = await app.call("/chat", { conversationId: conv, message: "hello?" });
    expect(busy.status).toBe(409);
    expect((await app.call(`/conversations/${conv}/actions/nope/confirm`, {})).status).toBe(404);
    const confirmed = await app.events(await app.call(`/conversations/${conv}/actions/${pending.data.actionId}/confirm`, { editedInput: { projectId: "p9" }, context: turnCtx }));
    expect(confirmed.find((e) => e.event === "tool_result")!.data).toMatchObject({ name: "run_start", structured: { runId: "r_1" } });
    expect(app.log).toContain('POST orchestrator /projects/p9/runs {}');
    // the second sensitive call of the same message was answered with an error, not lost
    expect(JSON.stringify(app.provider.calls[1]!.messages)).toContain("One action needs the user's confirmation already");
    // cancel
    const ev2 = await app.events(await app.call("/chat", { conversationId: conv, message: "set speed 50" }));
    const p2 = ev2.find((e) => e.event === "pending_action")!;
    const cancelled = await app.events(await app.call(`/conversations/${conv}/actions/${p2.data.actionId}/cancel`, {}));
    expect(cancelled.filter((e) => e.event === "text").map((e) => e.data.delta).join("")).toBe("Fine, not set.");
    expect(JSON.stringify(app.provider.calls[3]!.messages)).toContain("The user cancelled this action");
    expect(app.log.some((l) => l.startsWith("POST signalGateway"))).toBe(false);
  });

  test("license: ai.assistant denied ⇒ 403 not_entitled before the LLM; PDP unreachable ⇒ 503 (fail closed)", async () => {
    const denied = await chatApp([{ content: [{ type: "text", text: "never" }], stopReason: "end_turn" }], {
      entitled: () => entitlementFrom(async () => ({ feature: "ai.assistant", allowed: false, reason: "ai.assistant is not part of the community license" })),
    });
    const res = await denied.call("/chat", { message: "hi", context: turnCtx });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_entitled", feature: "ai.assistant", message: expect.stringContaining("community") });
    expect(denied.provider.calls).toHaveLength(0);
    const down = await chatApp([], { entitled: () => entitlementFrom(async () => { throw new Error("orchestrator GET /entitlements/ai.assistant ⇒ 502"); }) });
    expect((await down.call("/chat", { message: "hi" })).status).toBe(503);
    const ok = await chatApp([{ content: [{ type: "text", text: "Hello" }], stopReason: "end_turn" }], { entitled: () => entitlementFrom(async () => ({ allowed: true, reason: "" })) });
    expect((await ok.call("/chat", { message: "hi", context: turnCtx })).status).toBe(200);
  });

  test("rate limit per user: the 21st message in a minute is refused, another user is not affected", async () => {
    let t = 0;
    const rl = new RateLimiter(20, () => t);
    for (let i = 0; i < 20; i++) expect(rl.allow("a")).toBe(true);
    expect(rl.allow("a")).toBe(false);
    expect(rl.allow("b")).toBe(true);
    t = 60_001;
    expect(rl.allow("a")).toBe(true);
    const app = await chatApp([], { rate: 1 });
    expect((await app.call("/chat", { message: "one" })).status).toBe(200);
    expect((await app.call("/chat", { message: "two" })).status).toBe(429);
    expect((await app.call("/chat", { message: "three" }, "u2")).status).toBe(200);
  });

  test("conversations belong to their user; history is normalized for providers", async () => {
    const app = await chatApp([{ content: [{ type: "text", text: "hi" }], stopReason: "end_turn" }]);
    const ev = await app.events(await app.call("/chat", { message: "hello" }));
    const conv = ev.at(-1)!.data.conversationId as string;
    expect((await app.call("/chat", { conversationId: conv, message: "x" }, "intruder")).status).toBe(404);
    const list = await app.h(new Request("http://ai/conversations", { headers: { "x-sv-user-id": "u1" } }), ctx);
    expect((await list.json()).conversations).toMatchObject([{ id: conv, title: "hello" }]);
    expect(normalizeHistory([{ role: "user", content: "a" }, { role: "user", content: [{ type: "text", text: "b" }] }])).toEqual([{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }]);
  });

  test("pending actions expire (TTL); old conversations are purged", async () => {
    let t = 0;
    const store = new MemoryStore(() => t);
    await store.createConversation({ id: "c", userId: "u", title: "", createdAt: 0, updatedAt: 0 });
    await store.setPending({ actionId: "a", conversationId: "c", toolName: "run_stop", toolUseId: "x", toolInput: {}, otherResults: [], createdAt: 0, expiresAt: 100 });
    expect(await store.pending("c")).not.toBeNull();
    t = 100;
    expect(await store.pending("c")).toBeNull();
    expect(await store.purge(50)).toBe(1);
  });
});

describe("MCP server + client (M10-T03/T06)", () => {
  const services = fakeServices();
  const blocks = new BlockCatalog(services);
  const tools = createTools(services, blocks);
  const url = serve(
    createMcpHandler({
      tools,
      sensitive: (n) => SENSITIVE_TOOL_NAMES.has(n),
      tokens: [
        { token: "read-token-0123456789", name: "reader", scopes: ["tools"] },
        { token: "auto-token-0123456789", name: "robot", scopes: ["tools", "actions:auto"] },
      ],
      version: "0.1.0",
    }),
  );

  const connect = async (token?: string) => {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} } }));
    return client;
  };

  test("13 tools, statically safe or sensitive; bearer required", async () => {
    expect(SAFE_TOOL_NAMES.size + SENSITIVE_TOOL_NAMES.size).toBe(13);
    await expect(connect()).rejects.toThrow();
    const c = await connect("read-token-0123456789");
    const listed = await c.listTools();
    expect(listed.tools.map((t) => t.name).sort()).toEqual([...SAFE_TOOL_NAMES, ...SENSITIVE_TOOL_NAMES].sort());
    expect(listed.tools.find((t) => t.name === "run_start")!.annotations).toMatchObject({ destructiveHint: true });
    const r = (await c.callTool({ name: "vss_search", arguments: { query: "speed" } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain("Vehicle.Speed");
    const denied = (await c.callTool({ name: "run_start", arguments: { projectId: "p1" } })) as { isError?: boolean; structuredContent?: Record<string, unknown> };
    expect(denied).toMatchObject({ isError: true, structuredContent: { error: "CONFIRMATION_REQUIRED" } });
    await c.close();
  });

  test("actions:auto runs sensitive tools and returns structuredContent", async () => {
    const c = await connect("auto-token-0123456789");
    const r = (await c.callTool({ name: "run_start", arguments: { projectId: "p1" } })) as { structuredContent?: Record<string, unknown> };
    expect(r.structuredContent).toMatchObject({ runId: "r_1", editorUrl: "http://ide/?folder=x" });
    await c.close();
  });

  test("client: external tools are namespaced and confirmed unless declared safe", async () => {
    const ext = await connectExternal([{ name: "sim", url: `${url}/mcp`, token: "read-token-0123456789", safeTools: ["blocks_list"] }, { name: "down", url: "http://127.0.0.1:1/mcp" }]);
    expect(ext.tools.map((t) => t.name)).toContain(extName("sim", "vss_search"));
    expect(ext.sensitive.has(extName("sim", "vss_search"))).toBe(true);
    expect(ext.sensitive.has(extName("sim", "blocks_list"))).toBe(false);
    const out = await ext.tools.find((t) => t.name === extName("sim", "blocks_list"))!.run({}, { userId: "u", conversationId: "c" });
    expect(out.text).toContain("sv_if");
    await ext.close();
  });
});

describe("no LLM path to codegen (ADR-0030 §8)", () => {
  test("no tool writes source files; the agent changes workflows only through WorkflowPatch proposals", () => {
    const tools = createTools(fakeServices(), new BlockCatalog(fakeServices()));
    const text = JSON.stringify(tools.map((t) => [t.name, t.description, t.input_schema]));
    expect(text).not.toMatch(/codegen|generate code|\.cpp|write file/i);
    expect(readFileSync(new URL("./tools.ts", import.meta.url), "utf8")).not.toMatch(/codegen-cpp|\/generate"|"\/commits"/);
    expect(JSON.parse(readFileSync(`${fixturesDir}golden/GW-B/graph.json`, "utf8")).blocks).toHaveLength(4);
  });
});

describe("references by name (M10-T05)", () => {
  test("a reference written with a ref or id becomes the block's normalized name; names and VSS paths stay", async () => {
    const { referencesByName } = await import("./patch.ts");
    const base: WorkflowGraph = { ...emptyGraph("wf", "W", "v4.0"), blocks: [{ id: "b7", type: "sv_on_timer", name: "Every second", props: {} }] };
    const ops = referencesByName(base, [
      { op: "add_block", ref: "t1", type: "sv_on_signal_changed", name: "SoC changed", props: { path: "Vehicle.Speed" } },
      { op: "add_block", ref: "c1", type: "sv_if", props: { condition: "<t1.value> < 20 && <Vehicle.IsMoving> && <socchanged.value> > 0 && <b7.tick> > 1" } },
      { op: "set_props", block: "c1", props: { list: [{ v: "<t1.previous>" }] } },
    ]);
    expect((ops[1] as unknown as { props: { condition: string } }).props.condition).toBe("<socchanged.value> < 20 && <Vehicle.IsMoving> && <socchanged.value> > 0 && <everysecond.tick> > 1");
    expect((ops[2] as unknown as { props: { list: { v: string }[] } }).props.list[0]!.v).toBe("<socchanged.previous>");
  });
});
