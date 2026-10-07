import { createLogger, createService, Metrics } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { existsSync, readFileSync } from "node:fs";
import { createOrchestratorHandler } from "./app.ts";
import { EntitlementService, loadLicense } from "./entitlements.ts";
import { correlation, httpClients } from "./clients.ts";
import { EventHub } from "./events.ts";
import { runGeneration } from "./pipeline.ts";
import { PgRepo } from "./repo.ts";
import { RunManager } from "./runs.ts";

const port = Number(process.env.SV_ORCHESTRATOR_PORT ?? 4030);
const log = createLogger({ service: "orchestrator" });
const secret = process.env.INTERNAL_API_SECRET ?? "";
if (!secret) log.warn("INTERNAL_API_SECRET is not set: every orchestrator request will be rejected (fail closed)");
const parseMap = (text: string) =>
  Object.fromEntries(
    text
      .split(",")
      .map((x) => x.trim().split("=", 2))
      .filter((kv): kv is [string, string] => kv.length === 2 && Boolean(kv[0]) && Boolean(kv[1])),
  );

const repo = PgRepo.connect(process.env.SV_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://postgres:postgres@studio-db:5432/simvehicleapp");
// The database starts with the stack: wait for it, then migrate schema `sv` (advisory-locked).
for (let attempt = 1; ; attempt++) {
  try {
    await repo.migrate();
    break;
  } catch (e) {
    if (attempt >= 60) throw e;
    log.warn("database not ready, retrying", { attempt, err: (e as Error).message });
    await Bun.sleep(2000);
  }
}
const requeued = await repo.requeueRunning();
if (requeued) log.warn("requeued generations interrupted by a restart", { requeued });

const clients = httpClients({
  compiler: process.env.SV_COMPILER_URL ?? "http://compiler:4020",
  workspace: process.env.SV_WORKSPACE_URL ?? "http://workspace:4040",
  backends: parseMap(process.env.SV_BACKENDS ?? "cpp=http://codegen-cpp:4110"),
  toolchains: parseMap(process.env.SV_TOOLCHAINS ?? "cpp=http://toolchain-cpp:4210"),
  signalGateway: process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050",
  secret,
});
const hub = new EventHub();
// Metrics (ADR-0033 §2): SynCode stage durations, generation results by diagnostic code, runs, trace events.
const metrics = new Metrics();
const stageMs = metrics.histogram("syncode_stage_duration_ms", "SynCode stage duration (ms) by stage and state.");
const generations = metrics.counter("syncode_generations_total", "SynCode generations by result and first diagnostic code.");
const runsEnded = metrics.counter("runs_ended_total", "Runs ended by state and first diagnostic code.");
const traceEvents = metrics.counter("run_trace_events_total", "Trace events stored from running apps.");
const pipelineMetrics = {
  stage: (name: string, state: string, ms: number) => stageMs.observe({ stage: name, state }, ms),
  generation: (result: string, code?: string) => generations.inc({ result, code: code ?? "" }),
};
// Licensed features (ADR-0031): SV_LICENSE_MODE=full (MVP) allows everything and logs what the license says.
const keyFile = process.env.SV_LICENSE_PUBLIC_KEY_FILE ?? "/src/simvehicleapp-orchestrator/license-public.pem";
// PEM text, or the PEM base64-encoded (one line, easier to pass through .env/compose).
const rawKey = process.env.SV_LICENSE_PUBLIC_KEY?.trim() || (existsSync(keyFile) ? readFileSync(keyFile, "utf8") : undefined);
const publicKey = rawKey && !rawKey.startsWith("-----") ? Buffer.from(rawKey, "base64").toString("utf8") : rawKey;
const entitlements = new EntitlementService(process.env.SV_LICENSE_MODE === "enforce" ? "enforce" : "full", loadLicense(process.env.SV_LICENSE_KEY, publicKey));
log.info("license", entitlements.status);
// One databroker per VSS release (ADR-0024 §6), the same map the signal-gateway uses.
const runs = new RunManager({
  repo,
  clients,
  hub,
  databrokers: parseMap(process.env.SV_DATABROKERS ?? "v4.0=databroker:55555,v4.2=databroker-v4-2:55555"),
  log,
  metrics: { runEnded: (state, code) => runsEnded.inc({ state, code: code ?? "" }), traceEvents: (n) => traceEvents.inc({}, n) },
});
metrics.gauge("runs_active", "Runs starting, running or stopping.", () => runs.activeCount);
const stale = await runs.recover();
if (stale) log.warn("stopped runs left active by a restart", { runs: stale });
const ideUrl = process.env.SV_IDE_URL;

// One worker: generations run one after another (the toolchain builds one project at a time anyway).
let wake: (() => void) | null = null;
const kick = () => wake?.();
(async () => {
  for (;;) {
    const g = await repo.claimGeneration().catch((e) => (log.error("claim failed", { err: e }), null));
    if (!g) {
      await Promise.race([Bun.sleep(5000), new Promise<void>((r) => (wake = r))]);
      wake = null;
      continue;
    }
    log.info("generation started", { generation: g.id });
    // Every service call of this SynCode carries the generation id as its request id (log correlation).
    const done = await correlation.run(g.id, () => runGeneration(g, { repo, clients, events: hub, ideUrl, metrics: pipelineMetrics })).catch((e) => (log.error("generation crashed", { generation: g.id, err: e }), null));
    log.info("generation finished", { generation: g.id, state: done?.state, stage: done?.stage });
  }
})();

const background = (p: Promise<void>) => void p.catch((e) => log.error("background task failed", { err: e }));
const app = createOrchestratorHandler({ repo, clients, hub, runs, entitlements, ideUrl, kick, background });
// Calls made while handling a request carry its request id (from the studio BFF) to the next service.
const handler = createService({ name: "orchestrator", version: pkg.version, logger: log, metrics }, (req, ctx) => correlation.run(ctx.requestId, () => app(req, ctx)));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port });
