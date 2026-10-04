import { createLogger, createService } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createCompilerHandler } from "./app.ts";
import { catalogVehicleLookup } from "./vehicle-lookup.ts";

const port = Number(process.env.SV_COMPILER_PORT ?? 4020);
const log = createLogger({ service: "compiler" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every compiler request will be rejected (fail closed)");

const vehicle = catalogVehicleLookup({
  baseUrl: process.env.SV_CATALOG_URL ?? "http://vss-catalog:4010",
  secret: process.env.INTERNAL_API_SECRET ?? "",
});
const handler = createService({ name: "compiler", version: pkg.version, logger: log }, createCompilerHandler({ vehicle }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port });
