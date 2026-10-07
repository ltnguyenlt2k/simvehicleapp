import { createLogger, createService, Metrics } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createBackendHandler } from "./app.ts";

const port = Number(process.env.SV_CODEGEN_PORT ?? 4120);
const log = createLogger({ service: "codegen-python" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every backend request will be rejected (fail closed)");

const handler = createService({ name: "codegen-python", version: pkg.version, logger: log, metrics: new Metrics() }, createBackendHandler());
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port });
