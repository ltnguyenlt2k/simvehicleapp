import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runTool, type Tool, type ToolOutcome } from "./tools.ts";

/**
 * MCP (ADR-0030 §3–4, M10-T03/T06). Server: the `simvehicleapp` tools over Streamable HTTP at `/mcp`
 * (MCP SDK 1.x, stateless, bearer token). A sensitive tool answers CONFIRMATION_REQUIRED unless the token
 * has the `actions:auto` scope (analysis/09 §4a.7). Client: the tools of external MCP servers
 * (`SV_MCP_CLIENTS`), namespaced and confirmed by default, connected for one chat turn at a time.
 */

export interface McpToken {
  token: string;
  name: string;
  scopes: string[];
}

/** `SV_MCP_TOKENS` (JSON [{token, name, scopes}]) and/or `SV_MCP_TOKEN` (no auto actions). */
export function mcpTokens(env: Record<string, string | undefined>): McpToken[] {
  const out: McpToken[] = [];
  if (env.SV_MCP_TOKEN) out.push({ token: env.SV_MCP_TOKEN, name: "default", scopes: ["tools"] });
  if (env.SV_MCP_TOKENS) {
    for (const t of JSON.parse(env.SV_MCP_TOKENS) as McpToken[]) if (t.token && t.token.length >= 16) out.push({ token: t.token, name: t.name ?? "token", scopes: t.scopes ?? ["tools"] });
  }
  return out;
}

const toMcp = (o: ToolOutcome) => ({
  content: [{ type: "text" as const, text: o.text }],
  ...(o.structured ? { structuredContent: o.structured } : {}),
  ...(o.isError ? { isError: true } : {}),
});

export function createMcpHandler(opts: { tools: Tool[]; sensitive(name: string): boolean; tokens: McpToken[]; version: string; log?: { info(m: string, d?: Record<string, unknown>): void } }) {
  return async (req: Request): Promise<Response> => {
    const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    const token = bearer ? opts.tokens.find((t) => t.token === bearer) : undefined;
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": "Bearer" } });
    const server = new Server({ name: "simvehicleapp", version: opts.version }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: opts.sensitive(t.name) ? `${t.description} (needs confirmation)` : t.description,
        inputSchema: t.input_schema as { type: "object" },
        annotations: { readOnlyHint: !opts.sensitive(t.name), destructiveHint: opts.sensitive(t.name) },
      })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (r) => {
      const tool = opts.tools.find((t) => t.name === r.params.name);
      if (!tool) return toMcp({ text: `Unknown tool ${r.params.name}.`, isError: true });
      if (opts.sensitive(tool.name) && !token.scopes.includes("actions:auto")) {
        return { content: [{ type: "text" as const, text: `CONFIRMATION_REQUIRED: ${tool.name} acts on real things; it needs a token with the actions:auto scope, or the studio chat.` }], structuredContent: { error: "CONFIRMATION_REQUIRED", tool: tool.name }, isError: true };
      }
      opts.log?.info("mcp tool call", { token: token.name, tool: tool.name });
      return toMcp(await runTool(tool, (r.params.arguments ?? {}) as Record<string, unknown>, { userId: `mcp:${token.name}`, conversationId: "mcp" }));
    });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      void server.close();
    }
  };
}

export interface ExternalServer {
  name: string;
  url: string;
  token?: string;
  /** Tools of this server that run without confirmation (all others are confirmed). */
  safeTools?: string[];
}

/** `SV_MCP_CLIENTS`: JSON [{name, url, token?, safeTools?}]. */
export function externalServers(env: Record<string, string | undefined>): ExternalServer[] {
  if (!env.SV_MCP_CLIENTS?.trim()) return [];
  return (JSON.parse(env.SV_MCP_CLIENTS) as ExternalServer[]).filter((s) => /^[a-z0-9][a-z0-9-]{0,30}$/.test(s.name ?? "") && /^https?:\/\//.test(s.url ?? ""));
}

/** Tool name the LLM sees for an external tool (`ext.<server>.<tool>` in the UI; providers forbid dots). */
export const extName = (server: string, tool: string) => `ext__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

/** Connects to the external servers for one turn; failing servers are skipped (logged). */
export async function connectExternal(servers: ExternalServer[], log?: { warn(m: string, d?: Record<string, unknown>): void }): Promise<{ tools: Tool[]; sensitive: Set<string>; close(): Promise<void> }> {
  const clients: Client[] = [];
  const tools: Tool[] = [];
  const sensitive = new Set<string>();
  for (const s of servers) {
    try {
      const client = new Client({ name: "simvehicleapp-ai", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.token ? { authorization: `Bearer ${s.token}` } : {} } });
      await client.connect(transport);
      clients.push(client);
      const listed = await client.listTools();
      for (const t of listed.tools) {
        const name = extName(s.name, t.name);
        if (!(s.safeTools ?? []).includes(t.name)) sensitive.add(name);
        tools.push({
          name,
          description: `[ext.${s.name}.${t.name}] ${t.description ?? ""}`.trim(),
          input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
          async run(input) {
            const r = (await client.callTool({ name: t.name, arguments: input })) as { content?: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
            const text = (r.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
            return { text: text || "(no content)", ...(r.structuredContent ? { structured: r.structuredContent } : {}), ...(r.isError ? { isError: true } : {}) };
          },
        });
      }
    } catch (e) {
      log?.warn("external MCP server unavailable", { server: s.name, error: (e as Error).message });
    }
  }
  return { tools, sensitive, close: async () => void (await Promise.allSettled(clients.map((c) => c.close()))) };
}
