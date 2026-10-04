import { createLogger, createService } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createCompilerHandler } from "./app.ts";

const port = Number(process.env.SV_COMPILER_PORT ?? 4020);
const log = createLogger({ service: "compiler" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every compiler request will be rejected (fail closed)");

const handler = createService({ name: "compiler", version: pkg.version, logger: log }, createCompilerHandler());
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port });
