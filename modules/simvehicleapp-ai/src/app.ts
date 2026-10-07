import type { RequestContext } from "@simvehicleapp/service-kit";
import { type AgentDeps, type AgentEvent, cancelAction, confirmAction, NUDGE_PREFIX, runTurn } from "./agent.ts";
import { connectExternal, type ExternalServer } from "./mcp.ts";
import { systemPrompt } from "./prompt.ts";
import type { LlmProvider } from "./providers/types.ts";
import type { Store } from "./store.ts";
import { type BlockCatalog, SENSITIVE_TOOL_NAMES, type Tool, type ToolContext } from "./tools.ts";

/**
 * HTTP surface of the ai-assistant (`openapi/ai-assistant.v1.yaml`, ADR-0030): chat turns as SSE,
 * conversations, confirmation/cancellation of the pending action (SSE continuation), status. The studio
 * BFF is the only caller: it sends the user id (`x-sv-user-id`) and the context of the turn (the open
 * workflow, its project). Rate limit per user (§9).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;

export interface AppDeps {
  provider: LlmProvider | { error: string };
  store: Store;
  tools: Tool[];
  blocks: BlockCatalog;
  external: ExternalServer[];
  maxSteps: number;
  ratePerMinute: number;
  pendingTtlMs: number;
  newId(): string;
  now?: () => number;
  /** License decision for `ai.assistant` (orchestrator PDP, ADR-0031 §2); absent ⇒ allowed (tests). */
  entitled?: () => Promise<Entitlement>;
}

export type Entitlement = { allowed: true } | { allowed: false; status: 403 | 503; reason: string };

/** The orchestrator's decision; an unreachable PDP denies (fail closed: the license cannot be checked). */
export async function entitlementFrom(ask: () => Promise<unknown>): Promise<Entitlement> {
  try {
    const d = (await ask()) as { allowed?: unknown; reason?: unknown } | null;
    return d?.allowed === true ? { allowed: true } : { allowed: false, status: 403, reason: String(d?.reason ?? "ai.assistant is not licensed") };
  } catch (e) {
    return { allowed: false, status: 503, reason: `license check unavailable: ${(e as Error).message}` };
  }
}

/** Sliding one-minute window per user (never per IP, never shared, ADR-0030 §9). */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}
  allow(userId: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(userId) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(userId, recent);
    return true;
  }
}

/** The turn's context as the BFF sent it (only the shapes the tools read). */
function contextOf(userId: string, conversationId: string, raw: unknown): ToolContext {
  const c = (raw ?? {}) as Record<string, any>;
  const ctx: ToolContext = { userId, conversationId };
  const wf = c.workflow;
  if (wf && typeof wf.workflowId === "string" && typeof wf.vssRelease === "string") {
    ctx.workflow = { workflowId: wf.workflowId, vssRelease: wf.vssRelease, ...(typeof wf.name === "string" ? { name: wf.name } : {}), ...(wf.graph && Array.isArray(wf.graph.blocks) ? { graph: wf.graph } : {}) };
  }
  const p = c.project;
  if (p && typeof p.id === "string" && typeof p.vssRelease === "string") {
    ctx.project = { id: p.id, vssRelease: p.vssRelease, ...(Array.isArray(p.graphs) ? { graphs: p.graphs } : {}), ...(Array.isArray(p.scenarios) ? { scenarios: p.scenarios } : {}) };
  }
  return ctx;
}

/** Display form of a conversation's messages (text and tool calls; tool results are not shown). */
function display(messages: { role: string; content: unknown }[]) {
  return messages.flatMap((m) => {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content as { type: string; text?: string; name?: string; input?: unknown }[]);
    const text = blocks
      .filter((b) => b.type === "text" && !b.text?.startsWith(NUDGE_PREFIX))
      .map((b) => b.text)
      .join("");
    const tools = blocks.filter((b) => b.type === "tool_use").map((b) => ({ name: b.name, input: b.input }));
    return text || tools.length ? [{ role: m.role, text, ...(tools.length ? { tools } : {}) }] : [];
  });
}

export function createAssistantHandler(d: AppDeps) {
  const now = d.now ?? Date.now;
  const limiter = new RateLimiter(d.ratePerMinute, now);

  /** Agent deps of one turn: registry + external MCP tools (connected for this turn only). */
  const turn = async (ctx: ToolContext, log: RequestContext["log"]) => {
    const provider = d.provider as LlmProvider;
    const ext = await connectExternal(d.external, log);
    const catalog = await d.blocks.summary().catch(() => "(block catalog unavailable — call blocks_list)");
    const deps: AgentDeps = {
      provider,
      store: d.store,
      tools: [...d.tools, ...ext.tools],
      sensitive: (name) => SENSITIVE_TOOL_NAMES.has(name) || ext.sensitive.has(name),
      system: systemPrompt(catalog, ctx),
      maxSteps: d.maxSteps,
      newId: d.newId,
      now,
      pendingTtlMs: d.pendingTtlMs,
      log,
    };
    return { deps, close: ext.close };
  };

  /** SSE response of a turn; the work runs while the client reads (and stops if it leaves). */
  const stream = (req: Request, first: AgentEvent | null, work: (emit: (e: AgentEvent) => void, signal: AbortSignal) => Promise<void>) => {
    const enc = new TextEncoder();
    const abort = new AbortController();
    req.signal.addEventListener("abort", () => abort.abort());
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let open = true;
        const emit = (e: AgentEvent) => {
          if (open) controller.enqueue(enc.encode(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
        };
        if (first) emit(first);
        try {
          await work(emit, abort.signal);
        } catch (e) {
          emit({ event: "error", data: { message: (e as Error).message } });
        }
        open = false;
        controller.close();
      },
      cancel() {
        abort.abort();
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
  };

  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (url.pathname === "/status" && req.method === "GET") {
      const p = d.provider;
      return json(200, "error" in p ? { configured: false, reason: p.error, externalServers: d.external.map((s) => s.name) } : { configured: true, provider: p.name, model: p.model, externalServers: d.external.map((s) => s.name) });
    }

    const userId = req.headers.get("x-sv-user-id") ?? "";
    if (!ID.test(userId)) return json(400, { error: "invalid_request", message: "x-sv-user-id is required" });
    // A turn (chat, confirm, cancel) calls the LLM: licensed feature `ai.assistant`.
    if (req.method === "POST" && d.entitled) {
      const e = await d.entitled();
      if (!e.allowed) {
        ctx.log.info("entitlement denied", { feature: "ai.assistant", reason: e.reason });
        return json(e.status, { error: e.status === 403 ? "not_entitled" : "unavailable", feature: "ai.assistant", message: e.reason });
      }
    }

    if (url.pathname === "/chat" && req.method === "POST") {
      const b = (await req.json().catch(() => null)) as { conversationId?: string; message?: string; context?: unknown } | null;
      if (!b || typeof b.message !== "string" || !b.message.trim() || b.message.length > 20_000) return json(400, { error: "invalid_request", message: "message (1…20 000 characters) is required" });
      if ("error" in d.provider) return json(503, { error: "not_configured", message: d.provider.error });
      if (!limiter.allow(userId)) return json(429, { error: "rate_limited", message: `At most ${d.ratePerMinute} messages per minute` });
      let conversationId = b.conversationId;
      if (conversationId) {
        const c = ID.test(conversationId) ? await d.store.conversation(conversationId) : null;
        if (!c || c.userId !== userId) return json(404, { error: "not_found" });
        const pending = await d.store.pending(conversationId);
        if (pending) return json(409, { error: "pending_action", message: "Confirm or cancel the pending action first", actionId: pending.actionId, toolName: pending.toolName });
        await d.store.touch(conversationId, {});
      } else {
        conversationId = `c_${d.newId()}`;
        const t = now();
        const workflowId = (b.context as { workflow?: { workflowId?: string } } | undefined)?.workflow?.workflowId;
        await d.store.createConversation({ id: conversationId, userId, title: b.message.trim().slice(0, 80), ...(typeof workflowId === "string" ? { workflowId } : {}), createdAt: t, updatedAt: t });
      }
      const id = conversationId;
      const toolCtx = contextOf(userId, id, b.context);
      ctx.log.info("chat turn", { conversation: id, workflow: toolCtx.workflow?.workflowId });
      return stream(req, { event: "text", data: { delta: "" } }, async (emit, signal) => {
        const { deps, close } = await turn(toolCtx, ctx.log);
        try {
          await runTurn(deps, id, [{ type: "text", text: b.message! }], toolCtx, emit, signal);
        } finally {
          await close();
        }
      });
    }

    if (url.pathname === "/conversations" && req.method === "GET") {
      return json(200, { conversations: (await d.store.conversations(userId)).map((c) => ({ id: c.id, title: c.title, ...(c.workflowId ? { workflowId: c.workflowId } : {}), updatedAt: c.updatedAt })) });
    }

    if (parts[0] === "conversations" && parts[1]) {
      const c = ID.test(parts[1]) ? await d.store.conversation(parts[1]) : null;
      if (!c || c.userId !== userId) return json(404, { error: "not_found" });
      if (parts.length === 2 && req.method === "GET") {
        const pending = await d.store.pending(c.id);
        return json(200, { id: c.id, title: c.title, messages: display(await d.store.messages(c.id)), ...(pending ? { pending: { actionId: pending.actionId, toolName: pending.toolName, toolInput: pending.toolInput, expiresAt: pending.expiresAt } } : {}) });
      }
      if (parts[2] === "actions" && parts[3] && (parts[4] === "confirm" || parts[4] === "cancel") && parts.length === 5 && req.method === "POST") {
        const pending = await d.store.pending(c.id);
        if (!pending || pending.actionId !== parts[3]) return json(404, { error: "not_found", message: "Unknown or expired action" });
        if ("error" in d.provider) return json(503, { error: "not_configured", message: d.provider.error });
        if (!limiter.allow(userId)) return json(429, { error: "rate_limited" });
        const b = (await req.json().catch(() => ({}))) as { editedInput?: unknown; context?: unknown };
        const edited = b.editedInput && typeof b.editedInput === "object" && !Array.isArray(b.editedInput) ? (b.editedInput as Record<string, unknown>) : undefined;
        const toolCtx = contextOf(userId, c.id, b.context);
        ctx.log.info(parts[4] === "confirm" ? "action confirmed" : "action cancelled", { conversation: c.id, tool: pending.toolName, edited: Boolean(edited) });
        return stream(req, null, async (emit, signal) => {
          const { deps, close } = await turn(toolCtx, ctx.log);
          try {
            if (parts[4] === "confirm") await confirmAction(deps, pending, edited, toolCtx, emit, signal);
            else await cancelAction(deps, pending, toolCtx, emit, signal);
          } finally {
            await close();
          }
        });
      }
    }
    return json(404, { error: "not_found" });
  };
}
