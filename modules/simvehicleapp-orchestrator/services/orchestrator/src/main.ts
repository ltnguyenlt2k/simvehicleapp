import { createLogger, createService } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createOrchestratorHandler } from "./app.ts";
import { httpClients } from "./clients.ts";
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
// One databroker per VSS release (ADR-0024 §6), the same map the signal-gateway uses.
const runs = new RunManager({ repo, clients, hub, databrokers: parseMap(process.env.SV_DATABROKERS ?? "v4.0=databroker:55555,v4.2=databroker-v4-2:55555"), log });
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
    const done = await runGeneration(g, { repo, clients, events: hub, ideUrl }).catch((e) => (log.error("generation crashed", { generation: g.id, err: e }), null));
    log.info("generation finished", { generation: g.id, state: done?.state, stage: done?.stage });
  }
})();

const background = (p: Promise<void>) => void p.catch((e) => log.error("background task failed", { err: e }));
const handler = createService({ name: "orchestrator", version: pkg.version, logger: log }, createOrchestratorHandler({ repo, clients, hub, runs, ideUrl, kick, background }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port });
