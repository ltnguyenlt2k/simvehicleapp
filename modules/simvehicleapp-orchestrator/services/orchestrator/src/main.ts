import { createLogger, createService, Metrics, withRequestId } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { existsSync, readFileSync } from "node:fs";
import { createOrchestratorHandler } from "./app.ts";
import { EntitlementService, loadLicense } from "./entitlements.ts";
import { httpClients, type WorkspaceCapacity } from "./clients.ts";
import { CapacityProbe, limitsFromEnv } from "./governance.ts";
import { sweep } from "./lifecycle.ts";
import { EventHub } from "./events.ts";
import { runGeneration } from "./pipeline.ts";
import { PgRepo } from "./repo.ts";
import { RunManager, runLimitsFromEnv } from "./runs.ts";

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
  // Deployment routes to deploy targets (ADR-0060).
  vehicleGateway: process.env.SV_VEHICLE_GATEWAY_URL ?? "http://vehicle-gateway:4060",
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
  limits: runLimitsFromEnv(),
  deployLimits: { perWorkspace: Math.max(1, Number(process.env.SV_MAX_DEPLOYMENTS_PER_WORKSPACE ?? 2) || 2) },
  // Every backend's apps run on kuksa.val.v2 (ADR-0047 §4, parity P3 7/7 for C++, Python and Rust); override per
  // backend or for all, e.g. SV_DATABROKER_API=*=sdv.databroker.v1 or cpp=sdv.databroker.v1.
  databrokerApis: { "*": "kuksa.val.v2", ...parseMap(process.env.SV_DATABROKER_API ?? "") },
  log,
  metrics: { runEnded: (state, code) => runsEnded.inc({ state, code: code ?? "" }), traceEvents: (n) => traceEvents.inc({}, n) },
});
metrics.gauge("runs_active", "Runs starting, running or stopping.", () => runs.activeCount);
const stale = await runs.recover();
if (stale) log.warn("stopped runs left active by a restart", { runs: stale });
const ideUrl = process.env.SV_IDE_URL;

/** Database probe: every pool connection answers within `ms`. */
const dbAnswers = (ms: number) =>
  Promise.race([repo.ping().then(() => true), Bun.sleep(ms).then(() => false)]).catch(() => false);
// Watchdog: a pool whose connections stop answering would hang every request. Three probes in a row
// over 10 s ⇒ log and exit; Compose restarts the service and recovery requeues/stops what was running.
let stuck = 0;
setInterval(async () => {
  stuck = (await dbAnswers(10_000)) ? 0 : stuck + 1;
  if (stuck === 0) return;
  log.error("database pool does not answer", { probes: stuck });
  if (stuck >= 3) process.exit(1);
}, 30_000);

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
    // Every service call of this SynCode — and these log lines — carry the generation id as request id.
    const glog = log.child({ requestId: g.id });
    glog.info("generation started", { generation: g.id });
    const done = await withRequestId(g.id, () => runGeneration(g, { repo, clients, events: hub, ideUrl, metrics: pipelineMetrics })).catch((e) => (glog.error("generation crashed", { generation: g.id, err: e }), null));
    glog.info("generation finished", { generation: g.id, state: done?.state, stage: done?.stage });
  }
})();

const background = (p: Promise<void>) => void p.catch((e) => log.error("background task failed", { err: e }));
// Calls made while handling a request carry its request id (createService scopes it) to the next service.
// Host capacity governance (ADR-0053): limits, the workspace's free disk, the hourly sweeper and their metrics.
const limits = limitsFromEnv();
const probe = new CapacityProbe(clients, { onError: (e) => log.warn("capacity unavailable (checks let requests through)", { err: (e as Error).message }) });
log.info("capacity limits", { ...limits });
let capacity: WorkspaceCapacity | null = null;
let appsTotal = 0;
let queueLength = 0;
const refreshCapacity = async () => {
  capacity = await probe.get();
  appsTotal = (await repo.projects()).length;
  queueLength = (await repo.pendingGenerations()).filter((g) => g.state === "queued").length;
};
metrics.gauge("workspace_free_bytes", "Free bytes of the projects volume (ADR-0053).", () => capacity?.freeBytes ?? 0);
metrics.gauge("apps_total", "Vehicle apps on the host.", () => appsTotal);
metrics.gauge("generation_queue_length", "SynCode runs waiting in the queue.", () => queueLength);
const reclaimed = metrics.counter("reclaimed_bytes_total", "Bytes freed by the sweeper (idle app builds, failed apps, orphan toolchain caches).");
refreshCapacity().catch(() => {});
setInterval(() => refreshCapacity().catch(() => {}), 60_000);
const sweepEveryMs = Math.max(1, Number(process.env.SV_SWEEP_INTERVAL_MIN ?? 60) || 60) * 60_000;
let sweeping = false;
const runSweep = async () => {
  if (sweeping) return null; // never two sweeps at once
  sweeping = true;
  try {
    const r = await sweep({ repo, clients, runs, probe, log }, limits);
    if (r.freedBytes) reclaimed.inc({}, r.freedBytes);
    if (r.errors.length) log.warn("sweep errors", { errors: r.errors });
    return r;
  } catch (e) {
    log.error("sweep failed", { err: e });
    throw e;
  } finally {
    sweeping = false;
  }
};
// First sweep a few minutes after start (not during recovery), then every SV_SWEEP_INTERVAL_MIN (60).
const sweepQuietly = () => runSweep().catch(() => {});
setTimeout(() => {
  sweepQuietly();
  setInterval(sweepQuietly, sweepEveryMs);
}, 5 * 60_000);

const handler = createService({ name: "orchestrator", version: pkg.version, logger: log, metrics, checks: async () => ({ database: (await dbAnswers(2_000)) ? "ok" : "fail" }) }, createOrchestratorHandler({ repo, clients, hub, runs, entitlements, ideUrl, kick, background, limits, probe, sweep: runSweep, secret: process.env.INTERNAL_API_SECRET }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port });
