import { createLogger, createService, Metrics } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createAgentHandler } from "./app.ts";
import { createPlanner, defaultConfig, validateJob } from "./commands.ts";
import { JobManager } from "./jobs.ts";
import { templateTar } from "./templates.ts";

const port = Number(process.env.SV_TOOLCHAIN_PORT ?? 4210);
const log = createLogger({ service: "toolchain-agent" });
if (!process.env.INTERNAL_API_SECRET) log.warn("INTERNAL_API_SECRET is not set: every toolchain request will be rejected (fail closed)");

const cfg = defaultConfig();
const jobs = new JobManager(createPlanner(cfg), undefined, undefined, (kind, project, options) => validateJob(cfg, kind, project, options));
// Build durations, cold or warm, show as deps/build job durations (ADR-0033 §2).
const metrics = new Metrics();
const jobMs = metrics.histogram("toolchain_job_duration_ms", "Toolchain job duration (ms) by kind and final state.");
jobs.onFinished = (kind, state, ms) => jobMs.observe({ kind, state }, ms);
const handler = createService({ name: "toolchain-agent", version: pkg.version, logger: log, metrics }, createAgentHandler({ jobs, template: (lang) => templateTar(lang) }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port });
