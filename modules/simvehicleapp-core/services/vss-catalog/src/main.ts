import { createLogger, createService } from "@simvehicleapp/service-kit";
import { COVESA_PINS, CompositeSource, HttpSource, LocalFileSource, type VehicleModelSource } from "@simvehicleapp/vss";
import pkg from "../package.json" with { type: "json" };
import { Catalog } from "./catalog.ts";
import { createCatalogHandler } from "./app.ts";

const env = process.env;
const port = Number(env.SV_VSS_CATALOG_PORT ?? 4010);
const seedDir = env.SV_VSS_SEED_DIR ?? "/opt/sv/vss";
const cacheDir = env.SV_VSS_CACHE_DIR ?? "/var/cache/sv-vss";
const defaultRelease = env.SV_VSS_DEFAULT_RELEASE ?? "v4.0";
/** `0` keeps the service fully offline (seeded releases only). */
const httpEnabled = env.SV_VSS_HTTP !== "0";

const log = createLogger({ service: "vss-catalog" });
if (!env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every catalog request will be rejected (fail closed)");

const sources: VehicleModelSource[] = [await LocalFileSource.fromDirectory(seedDir)];
if (httpEnabled) sources.push(new HttpSource({ pins: COVESA_PINS, cacheDir }));
const catalog = new Catalog(new CompositeSource(sources), defaultRelease);

const handler = createService(
  {
    name: "vss-catalog",
    version: pkg.version,
    logger: log,
    checks: async () => {
      try {
        await catalog.get();
        return { defaultRelease: "ok" };
      } catch {
        return { defaultRelease: "fail" };
      }
    },
  },
  createCatalogHandler(catalog),
);

// Parse the default release before accepting traffic so the first toolbar request is fast.
await catalog.get().catch((err) => log.error("default release failed to load", { err, release: defaultRelease }));

const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler });
log.info("listening", { port: server.port, seedDir, httpEnabled, defaultRelease, releases: await catalog.releases() });
