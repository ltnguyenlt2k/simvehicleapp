import type { Clients } from "./clients.ts";
import type { CapacityProbe, Limits } from "./governance.ts";
import { provision } from "./projects.ts";
import { ACTIVE_RUN_STATES, type Project, type Repo } from "./repo.ts";
import type { RunManager } from "./runs.ts";

/**
 * Vehicle app lifecycle (ADR-0053 §A): delete, clean, repair, and the hourly sweeper. The orchestrator coordinates;
 * the workspace is the one that touches the projects volume (AGENTS §2.3) and each toolchain forgets its own caches.
 */

export interface LifecycleDeps {
  repo: Repo;
  clients: Clients;
  runs?: RunManager;
  probe?: CapacityProbe;
  log?: { info(msg: string, data?: Record<string, unknown>): void; warn(msg: string, data?: Record<string, unknown>): void };
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The app is busy (a SynCode building, a run that will not stop): 409. */
export class AppBusy extends Error {}
/** Repair of an app that is not `failed`: 409. */
export class AppNotFailed extends Error {}

const now = (d: LifecycleDeps) => (d.now ?? Date.now)();
const sleep = (d: LifecycleDeps, ms: number) => (d.sleep ?? Bun.sleep)(ms);

/** Cancels the app's queued SynCode runs; throws AppBusy when one is building. */
async function quiesceGenerations(d: LifecycleDeps, project: Project, verb: string): Promise<number> {
  let cancelled = 0;
  for (const g of await d.repo.pendingGenerations(project.id)) {
    if (g.state === "queued" && (await d.repo.cancelQueued(g.id, now(d)))) cancelled++;
  }
  // The worker may have claimed one between the list and the cancel: check again.
  if ((await d.repo.pendingGenerations(project.id)).some((g) => g.state === "running")) {
    throw new AppBusy(`A SynCode of ${project.name} is building: ${verb} it when it has finished`);
  }
  return cancelled;
}

/** Stops the app's active run (SIGINT, SIGKILL after 5 s by the toolchain) and waits for it to end (≤ `waitMs`). */
async function stopRuns(d: LifecycleDeps, project: Project, waitMs = 10_000): Promise<void> {
  const active = await d.repo.runs({ projectId: project.id, active: true });
  if (!active.length) return;
  if (!d.runs) throw new AppBusy(`${project.name} is running and runs cannot be stopped here`);
  for (const r of active) await d.runs.stop(r.id);
  const deadline = now(d) + waitMs;
  for (;;) {
    const still = (await d.repo.runs({ projectId: project.id, active: true })).filter((r) => ACTIVE_RUN_STATES.includes(r.state));
    if (!still.length) return;
    if (now(d) >= deadline) throw new AppBusy(`The run of ${project.name} did not stop: try again`);
    await sleep(d, 200);
  }
}

/**
 * Deletes an app: queued SynCode runs are cancelled (a building one ⇒ AppBusy), its run is stopped, the workspace
 * removes its folder and records, the toolchain forgets its caches (best effort: the sweeper's gc catches up), then
 * the rows go (cascade). Every step tolerates a part already gone, so a retry after a failure finishes the job.
 */
export async function deleteApp(d: LifecycleDeps, project: Project): Promise<{ cancelledGenerations: number }> {
  const cancelledGenerations = await quiesceGenerations(d, project, "delete");
  await stopRuns(d, project);
  const ws = await d.clients.workspaceDelete(project.slug);
  if (!ws.ok) throw new Error(`workspace could not delete ${project.slug} (${ws.status}${ws.message ? `: ${ws.message}` : ""})`);
  try {
    const tc = await d.clients.toolchainForget(project.language, project.slug);
    if (!tc.ok) d.log?.warn("toolchain did not forget the app cache (the sweeper gc will)", { app: project.slug, status: tc.status });
  } catch (e) {
    d.log?.warn("toolchain did not forget the app cache (the sweeper gc will)", { app: project.slug, err: (e as Error).message });
  }
  await d.repo.deleteProject(project.id);
  d.probe?.invalidate();
  d.log?.info("app deleted", { app: project.slug, cancelledGenerations });
  return { cancelledGenerations };
}

/** Removes the app's build outputs (sources stay); the next SynCode reinstalls dependencies and rebuilds. */
export async function cleanApp(d: LifecycleDeps, project: Project): Promise<{ freedBytes: number }> {
  if ((await d.repo.pendingGenerations(project.id)).length) throw new AppBusy(`A SynCode of ${project.name} is queued or building: clean it afterwards`);
  if ((await d.repo.runs({ projectId: project.id, active: true })).length) throw new AppBusy(`${project.name} is running: stop it first`);
  const r = await d.clients.workspaceClean(project.slug);
  if (!r.ok) throw new Error(`workspace could not clean ${project.slug} (${r.status})`);
  // The C++ dependency setup (Conan generators) lived in the build folder.
  await d.repo.updateProject(project.id, { depsInstalled: false });
  d.probe?.invalidate();
  d.log?.info("app cleaned", { app: project.slug, freedBytes: r.value.freedBytes });
  return r.value;
}

/** Re-creates a `failed` app from scratch, keeping its workflows and settings; returns at once (`creating`). */
export async function repairApp(d: LifecycleDeps, project: Project, background: (p: Promise<void>) => void): Promise<Project> {
  if (project.status !== "failed") throw new AppNotFailed(`Only a failed app can be repaired (${project.name} is ${project.status})`);
  await quiesceGenerations(d, project, "repair");
  const ws = await d.clients.workspaceDelete(project.slug);
  if (!ws.ok) throw new Error(`workspace could not remove ${project.slug} (${ws.status})`);
  await d.clients.toolchainForget(project.language, project.slug).catch(() => null);
  await d.repo.updateProject(project.id, { status: "creating", statusMessage: undefined, depsInstalled: false });
  const fresh = (await d.repo.project(project.id))!;
  background(provision(d.repo, d.clients, fresh));
  d.log?.info("app repair started", { app: project.slug });
  return fresh;
}

export interface SweepResult {
  deleted: string[];
  cleaned: string[];
  /** Apps left alone this time because they are running or have a SynCode queued/building. */
  skipped: string[];
  freedBytes: number;
  cachesRemoved: number;
  errors: string[];
}

/**
 * Hourly sweeper (ADR-0053 §6): deletes `failed` apps older than `failedTtlMs`, cleans the build outputs of apps idle
 * for `idleCleanMs`, then asks each toolchain to drop the caches of apps that no longer exist. Apps that are running or
 * have a SynCode in the queue are skipped (a demo left running for weeks is not "idle"). One app's failure never stops
 * the sweep (it is reported in `errors`).
 */
export async function sweep(d: LifecycleDeps, limits: Limits): Promise<SweepResult> {
  const out: SweepResult = { deleted: [], cleaned: [], skipped: [], freedBytes: 0, cachesRemoved: 0, errors: [] };
  const t = now(d);
  const projects = await d.repo.projects();
  const lastAt = new Map((await d.repo.lastActivity()).map((a) => [a.projectId, a.lastAt]));
  const pending = new Set((await d.repo.pendingGenerations()).map((g) => g.projectId));
  const running = new Set((await d.repo.runs({ active: true, limit: 1000 })).map((r) => r.projectId));
  for (const p of projects) {
    try {
      if (pending.has(p.id) || running.has(p.id)) {
        out.skipped.push(p.slug);
        continue;
      }
      const since = t - (lastAt.get(p.id) ?? p.updatedAt ?? p.createdAt ?? t);
      if (p.status === "failed" && limits.failedTtlMs > 0 && since > limits.failedTtlMs) {
        await deleteApp(d, p);
        out.deleted.push(p.slug);
      } else if (p.status === "ready" && limits.idleCleanMs > 0 && since > limits.idleCleanMs) {
        const size = await d.clients.workspaceSize(p.slug);
        if (size.ok && size.value.buildBytes > 0) {
          out.freedBytes += (await cleanApp(d, p)).freedBytes;
          out.cleaned.push(p.slug);
        }
      }
    } catch (e) {
      out.errors.push(`${p.slug}: ${(e as Error).message}`);
    }
  }
  const alive = (await d.repo.projects()).map((p) => p.slug);
  for (const language of new Set(["cpp", ...projects.map((p) => p.language)])) {
    try {
      const r = await d.clients.toolchainGc(language, alive);
      if (r.ok) {
        out.cachesRemoved += r.value.removed;
        out.freedBytes += r.value.freedBytes;
      }
    } catch (e) {
      out.errors.push(`gc ${language}: ${(e as Error).message}`);
    }
  }
  if (out.deleted.length || out.cleaned.length || out.cachesRemoved) d.probe?.invalidate();
  d.log?.info("sweep finished", { ...out, errors: out.errors.length });
  return out;
}
