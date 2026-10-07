import { createLogger, createService } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createAssistantHandler, entitlementFrom } from "./app.ts";
import { createMcpHandler, externalServers, mcpTokens } from "./mcp.ts";
import { providerFromEnv } from "./providers/index.ts";
import { httpServices } from "./services.ts";
import { PgStore } from "./store.ts";
import { BlockCatalog, createTools, SENSITIVE_TOOL_NAMES } from "./tools.ts";

const env = process.env;
const port = Number(env.SV_AI_PORT ?? 4300);
const log = createLogger({ service: "ai-assistant" });
const secret = env.INTERNAL_API_SECRET ?? "";
if (!secret) log.warn("INTERNAL_API_SECRET is not set: every request will be rejected (fail closed)");

const store = PgStore.connect(env.SV_DATABASE_URL ?? "postgres://postgres:postgres@studio-db:5432/simvehicleapp");
for (let attempt = 1; ; attempt++) {
  try {
    await store.migrate();
    break;
  } catch (e) {
    if (attempt >= 60) throw e;
    log.warn("database not ready, retrying", { attempt, err: (e as Error).message });
    await Bun.sleep(2000);
  }
}
// Retention (M10-T07): conversations untouched for SV_AI_RETENTION_DAYS are deleted, hourly.
const retentionDays = Number(env.SV_AI_RETENTION_DAYS ?? 30);
const purge = () => store.purge(Date.now() - retentionDays * 86_400_000).then((n) => n && log.info("conversations purged", { count: n, retentionDays }), (e) => log.warn("purge failed", { err: (e as Error).message }));
void purge();
setInterval(purge, 3_600_000);

const services = httpServices({
  catalog: env.SV_CATALOG_URL ?? "http://vss-catalog:4010",
  compiler: env.SV_COMPILER_URL ?? "http://compiler:4020",
  orchestrator: env.SV_ORCHESTRATOR_URL ?? "http://orchestrator:4030",
  signalGateway: env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050",
  secret,
});
const blocks = new BlockCatalog(services);
const tools = createTools(services, blocks);
const provider = providerFromEnv(env);
const external = externalServers(env);
log.info("ai provider", "error" in provider ? { configured: false, reason: provider.error } : { provider: provider.name, model: provider.model, externalServers: external.map((s) => s.name) });

const handler = createService(
  { name: "ai-assistant", version: pkg.version, logger: log },
  createAssistantHandler({
    provider,
    store,
    tools,
    blocks,
    external,
    maxSteps: Number(env.SV_AI_MAX_TOOL_STEPS ?? 6),
    ratePerMinute: Number(env.SV_AI_RATE_LIMIT_PER_MINUTE ?? 20),
    pendingTtlMs: 15 * 60_000,
    newId: () => crypto.randomUUID(),
    entitled: () => entitlementFrom(() => services.get("orchestrator", "/entitlements/ai.assistant", 3_000)),
  }),
);
const tokens = mcpTokens(env);
const mcp = createMcpHandler({ tools, sensitive: (n) => SENSITIVE_TOOL_NAMES.has(n), tokens, version: pkg.version, log });
if (!tokens.length) log.info("MCP server disabled: set SV_MCP_TOKEN or SV_MCP_TOKENS to expose /mcp");

// /mcp authenticates with its own bearer tokens (external agents); everything else is internal (BFF).
const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  idleTimeout: 0,
  fetch: async (req) => {
    if (new URL(req.url).pathname !== "/mcp" || !tokens.length) return handler(req);
    // External agents use the same licensed feature as the chat (asked once the bearer is known).
    const bearer = /^Bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
    if (!bearer || !tokens.some((t) => t.token === bearer)) return mcp(req);
    const e = await entitlementFrom(() => services.get("orchestrator", "/entitlements/ai.assistant", 3_000));
    if (!e.allowed) return Response.json({ error: e.status === 403 ? "not_entitled" : "unavailable", feature: "ai.assistant", message: e.reason }, { status: e.status });
    return mcp(req);
  },
});
log.info("listening", { port: server.port });
