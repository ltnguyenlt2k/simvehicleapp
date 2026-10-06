import { httpCapabilities } from "@simvehicleapp/compiler";
import { createLogger, createService, internalHeaders } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createCompilerHandler } from "./app.ts";
import { catalogModelHash, catalogVehicleLookup } from "./vehicle-lookup.ts";

const port = Number(process.env.SV_COMPILER_PORT ?? 4020);
const log = createLogger({ service: "compiler" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every compiler request will be rejected (fail closed)");

const catalog = {
  baseUrl: process.env.SV_CATALOG_URL ?? "http://vss-catalog:4010",
  secret: process.env.INTERNAL_API_SECRET ?? "",
};
const handler = createService(
  { name: "compiler", version: pkg.version, logger: log },
  createCompilerHandler({
    vehicle: catalogVehicleLookup(catalog),
    modelHash: catalogModelHash(catalog),
    capabilities: httpCapabilities({ backends: parseBackends(process.env.SV_BACKENDS ?? ""), headers: () => internalHeaders(crypto.randomUUID(), catalog.secret) }),
  }),
);
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port });

/** `SV_BACKENDS="cpp=http://compiler-code-cpp:4100,python=http://…"` (backends arrive in M6). */
function parseBackends(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of text.split(",").map((x) => x.trim()).filter(Boolean)) {
    const [id, url] = item.split("=", 2);
    if (id && url) out[id.trim()] = url.trim();
  }
  return out;
}
