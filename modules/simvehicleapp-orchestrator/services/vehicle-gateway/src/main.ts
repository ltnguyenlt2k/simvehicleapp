import { createLogger, createService, Metrics } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createVehicleGatewayHandler } from "./app.ts";

const port = Number(process.env.SV_VEHICLE_GATEWAY_PORT ?? 4060);
const log = createLogger({ service: "vehicle-gateway" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every vehicle-gateway request will be rejected (fail closed)");
// Ports of the deployment routes on sv-internal (ADR-0060), e.g. 57000-57099.
const [from, to] = (process.env.SV_VEHICLE_GATEWAY_PORTS ?? "57000-57099").split("-").map(Number);
const handler = createService(
  { name: "vehicle-gateway", version: pkg.version, logger: log, metrics: new Metrics() },
  createVehicleGatewayHandler({ log, ports: { from: from!, to: to ?? from! }, host: process.env.SV_VEHICLE_GATEWAY_HOST ?? "vehicle-gateway" }),
);
Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port, routes: `${from}-${to}` });
