import { createLogger, createService } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createWorkspaceHandler } from "./app.ts";
import { httpSources, parseMap } from "./sources.ts";
import { Store } from "./store.ts";

const port = Number(process.env.SV_WORKSPACE_PORT ?? 4040);
const log = createLogger({ service: "workspace" });
const secret = process.env.INTERNAL_API_SECRET ?? "";
if (!secret) log.warn("INTERNAL_API_SECRET is not set: every workspace request will be rejected (fail closed)");

const store = new Store(process.env.SV_WORKSPACE_ROOT ?? "/workspace");
// A commit interrupted by a crash is finished or undone before any request (ADR-0026 §3.5).
const recovered = store.recover();
if (recovered.rolledBack.length || recovered.finished.length) log.warn("recovered interrupted commits", recovered);

const sources = httpSources({
  toolchains: parseMap(process.env.SV_TOOLCHAINS ?? "cpp=http://toolchain-cpp:4210"),
  backends: parseMap(process.env.SV_BACKENDS ?? "cpp=http://codegen-cpp:4110"),
  catalog: process.env.SV_CATALOG_URL ?? "http://vss-catalog:4010",
  secret,
});
const handler = createService({ name: "workspace", version: pkg.version, logger: log }, createWorkspaceHandler(store, sources));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port, root: store.root });
