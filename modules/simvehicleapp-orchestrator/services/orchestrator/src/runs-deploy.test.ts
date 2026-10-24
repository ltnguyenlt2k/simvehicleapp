import { describe, expect, test } from "bun:test";
import type { Clients, Outcome, RouteBody, ToolchainJob } from "./clients.ts";
import { EventHub } from "./events.ts";
import { type Generation, initialVerification, type LogLine, MemoryRepo, type Project, STAGES } from "./repo.ts";
import { type RunLimits, RunManager, RunQuota, RunConflict } from "./runs.ts";

/** Deployments (ADR-0060, M18-T09): a run of the app on a deploy target's signals, through a vehicle-gateway route. */

const started = (): LogLine => ({ runId: "job", seq: 0, ts: 5, stream: "stdout", level: "info", msg: `SVTRACE ${JSON.stringify({ v: 1, ts: 1, app: "App", ev: "app.started" })}` });
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";

function fakeStack() {
  const calls: string[] = [];
  const routes: { id: string; body: RouteBody }[] = [];
  const jobs = new Map<string, { say?: (l: LogLine) => void; end?: (j: ToolchainJob) => void }>();
  let n = 0;
  const clients = {
    startJob: async (_l: string, kind: string, _p: string, options?: Record<string, unknown>): Promise<Outcome<ToolchainJob>> => {
      calls.push(`${kind}${options?.sandbox ? " sandbox" : ""}${options?.env ? ` ${JSON.stringify(options.env)}` : ""}`);
      if (kind === "stop") {
        const id = options?.runJobId as string;
        queueMicrotask(() => jobs.get(id)?.end?.({ id, state: "cancelled", exitCode: 130, diagnostics: [] }));
        return { ok: true, value: { id: "job-stop", state: "running", exitCode: null, diagnostics: [] } };
      }
      const id = `job-${++n}`;
      jobs.set(id, {});
      return { ok: true, value: { id, state: "running", exitCode: null, diagnostics: [] } };
    },
    getJob: async (_l: string, id: string) => (jobs.has(id) ? { id, state: "running", exitCode: null, diagnostics: [], sandbox: { address: "toolchain-cpp:56000" } } : null),
    followJob: (_l: string, id: string, _after: number, cb: (l: LogLine) => void) =>
      new Promise<ToolchainJob>((resolve) => {
        const j = jobs.get(id)!;
        j.say = cb;
        j.end = resolve;
      }),
    mirror: async (release: string, paths: string[], sandbox?: string) => void calls.push(`mirror ${release} [${paths.join(",")}]${sandbox ? ` on ${sandbox}` : ""}`),
    openRoute: async (id: string, body: RouteBody) => (routes.push({ id, body }), calls.push(`route open ${id} ${body.mode}`), { address: `vehicle-gateway:${57000 + routes.length - 1}` }),
    closeRoute: async (id: string) => void calls.push(`route close ${id}`),
    system: async () => [],
  } as unknown as Clients;
  return { clients, calls, routes, start: (jobId: string) => jobs.get(jobId)?.say?.(started()) };
}

async function setup(limits: Partial<RunLimits> = {}, perWorkspace = 2) {
  const repo = new MemoryRepo();
  const s = fakeStack();
  const project = async (slug: string): Promise<Project> =>
    (await repo.createProject({ id: crypto.randomUUID(), slug, name: slug, appName: "App", language: "cpp", vssRelease: "v4.0", settings: { mqttTopicPrefix: slug, traceLevel: "node" }, status: "ready" }))!;
  const gen = async (p: Project) => {
    const g: Generation = {
      id: `g_${crypto.randomUUID()}`,
      projectId: p.id,
      state: "succeeded",
      stages: STAGES.map((name) => ({ name, state: "passed" })),
      verification: initialVerification(),
      diagnostics: [],
      generatedFiles: [],
      workflows: [],
      runInfo: { traceMap: {}, signals: [{ path: HAZARD, vssType: "actuator", dataType: "boolean", access: ["write"] }, { path: "Vehicle.Speed", vssType: "sensor", dataType: "float", access: ["read"] }] },
      request: { graphs: [] },
      createdAt: Date.now(),
    };
    await repo.createGeneration(g);
    return g;
  };
  let n = 0;
  const runs = new RunManager({
    repo,
    clients: s.clients,
    hub: new EventHub(),
    databrokers: { "v4.0": "databroker:55555" },
    limits: { sandbox: true, perUser: 2, total: 3, maxMinutes: 30, maxExtensions: 3, ...limits },
    deployLimits: { perWorkspace },
    databrokerApis: { "*": "kuksa.val.v2" },
    newId: () => `r_${++n}`,
    batchMs: 1,
  });
  return { repo, s, project, gen, runs };
}

const until = async (cond: () => Promise<boolean> | boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await Bun.sleep(2);
  }
};

const ann = { userId: "u_ann", workspaceId: "w1" };
const target = { id: "t1", name: "Bench HIL", address: "hil.lab:55555", tls: true, token: "tok" };

describe("deployments (ADR-0060, M18-T09)", () => {
  test("the app's databroker is a route to the target; no mirror, no expiry; Stop closes the route", async () => {
    const { repo, s, project, gen, runs } = await setup();
    const p = await project("lka");
    const d = await runs.startDeployment(p, (await gen(p)).id, target, "read-only", ann);
    expect(s.routes).toEqual([{ id: d.id, body: { target: "hil.lab:55555", tls: true, token: "tok", mode: "read-only", actuators: [HAZARD] } }]);
    expect(d).toMatchObject({ deploy: { targetId: "t1", targetName: "Bench HIL", mode: "read-only" }, sandbox: "vehicle-gateway:57000" });
    const job = s.calls.find((c) => c.startsWith("run "))!;
    expect(job).toContain('"SDV_VEHICLEDATABROKER_ADDRESS":"grpc://vehicle-gateway:57000"');
    expect(job).not.toContain("sandbox");
    expect(s.calls.some((c) => c.startsWith("mirror") && c.includes(HAZARD))).toBe(false);
    s.start("job-1");
    await until(async () => (await repo.run(d.id))?.state === "running");
    expect((await repo.run(d.id))?.expiresAt).toBeUndefined();
    await runs.stop(d.id);
    await until(async () => (await repo.run(d.id))?.state === "stopped");
    expect(s.calls).toContain(`route close ${d.id}`);
  });

  test("an app runs and is deployed at once; deployed once; a workspace quota; runs and deployments counted apart", async () => {
    const { s, project, gen, runs } = await setup({ perUser: 1, total: 1 }, 1);
    const p = await project("lka");
    const g = await gen(p);
    const run = await runs.start(p, g.id, undefined, ann);
    const d = await runs.startDeployment(p, g.id, target, "read-write", ann);
    expect(run.deploy).toBeUndefined();
    expect(d.deploy?.mode).toBe("read-write");
    expect(runs.startDeployment(p, g.id, target, "read-only", ann)).rejects.toBeInstanceOf(RunConflict);
    const q = await project("comfort");
    const gq = await gen(q);
    const err = await runs.startDeployment(q, gq.id, target, "read-only", ann).catch((e) => e);
    expect(err).toBeInstanceOf(RunQuota);
    expect((err as RunQuota).diagnostic.code).toBe("DEPLOY_QUOTA_EXCEEDED");
    // Another workspace has its own quota.
    const other = await runs.startDeployment(q, gq.id, target, "read-only", { userId: "u_cy", workspaceId: "w2" });
    expect(other.deploy?.targetId).toBe("t1");
    expect(s.routes).toHaveLength(2);
  });

  test("on the shared stack (no sandboxes) a deployment does not take the one run slot", async () => {
    const { project, gen, runs } = await setup({ sandbox: false });
    const p = await project("lka");
    const q = await project("comfort");
    await runs.startDeployment(p, (await gen(p)).id, target, "read-only", ann);
    const r = await runs.start(q, (await gen(q)).id, undefined, ann);
    expect(r.state).toBe("starting");
  });
});

describe("deploy targets and deployments over HTTP (openapi/orchestrator.v1.yaml)", () => {
  test("a target keeps its token sealed; Test connection; deploy (same release only); delete refused while deployed; audit", async () => {
    const { createOrchestratorHandler } = await import("./app.ts");
    const { repo, s, project, gen, runs } = await setup();
    const probes: unknown[] = [];
    (s.clients as unknown as Record<string, unknown>).probeTarget = async (b: unknown) => (probes.push(b), { reachable: true, api: "kuksa.val.v2", server: { name: "databroker", version: "0.5.0" }, missing: [] });
    (s.clients as unknown as Record<string, unknown>).routeAudit = async () => ({ audit: [{ ts: 1, method: "/kuksa.val.v2.VAL/Actuate", allowed: false, reason: "read-only" }], forwarded: {} });
    const handler = createOrchestratorHandler({ repo, clients: s.clients, hub: new EventHub(), runs, secret: "sek", kick() {}, background() {} });
    const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;
    const call = (method: string, path: string, body?: unknown) => handler(new Request(`http://o${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), ctx);

    expect((await call("POST", "/deploy-targets", { workspaceId: "w1", name: "HIL", address: "nope", vssRelease: "v4.0" })).status).toBe(400);
    const created = await call("POST", "/deploy-targets", { workspaceId: "w1", name: "HIL", address: "hil.lab:55555", tls: true, token: "tok", vssRelease: "v4.0" });
    expect(created.status).toBe(201);
    const t = (await created.json()) as { id: string; hasToken: boolean; tokenEnc?: string };
    expect(t.hasToken).toBe(true);
    expect(t.tokenEnc).toBeUndefined();
    expect((await repo.deployTarget(t.id))?.tokenEnc).not.toContain("tok");
    expect((await call("POST", "/deploy-targets", { workspaceId: "w1", name: "HIL", address: "x:55555", vssRelease: "v4.0" })).status).toBe(409);
    expect(((await (await call("GET", "/deploy-targets?workspaceId=w1")).json()) as { targets: unknown[] }).targets).toHaveLength(1);
    expect(((await (await call("GET", "/deploy-targets?workspaceId=w2")).json()) as { targets: unknown[] }).targets).toHaveLength(0);

    // Test connection: the token is opened for the probe only.
    const tested = await call("POST", `/deploy-targets/${t.id}/test`, { workspaceId: "w1", paths: [HAZARD] });
    expect(await tested.json()).toMatchObject({ reachable: true });
    expect(probes).toEqual([{ target: "hil.lab:55555", tls: true, token: "tok", paths: [HAZARD] }]);
    expect((await call("POST", `/deploy-targets/${t.id}/test`, { workspaceId: "w2" })).status).toBe(404);

    const p = await project("lka");
    await gen(p);
    const v42 = await call("POST", "/deploy-targets", { workspaceId: "w1", name: "v4.2 bench", address: "b:55555", vssRelease: "v4.2" });
    const other = (await v42.json()) as { id: string };
    expect((await call("POST", `/projects/${p.id}/deployments`, { targetId: other.id, mode: "read-only", owner: ann })).status).toBe(409);
    expect((await call("POST", `/projects/${p.id}/deployments`, { targetId: t.id, mode: "read-only", owner: { userId: "u_x", workspaceId: "w2" } })).status).toBe(404);
    const dep = await call("POST", `/projects/${p.id}/deployments`, { targetId: t.id, mode: "read-only", owner: ann });
    expect(dep.status).toBe(202);
    const run = (await dep.json()) as { id: string; deploy: { mode: string } };
    expect(run.deploy.mode).toBe("read-only");
    expect(s.routes.at(-1)?.body.token).toBe("tok");
    expect((await call("DELETE", `/deploy-targets/${t.id}?workspaceId=w1`)).status).toBe(409);
    expect(((await (await call("GET", `/runs/${run.id}/audit`)).json()) as { audit: unknown[] }).audit).toHaveLength(1);
    await runs.stop(run.id);
    await until(async () => (await repo.run(run.id))?.state === "stopped");
    expect((await call("DELETE", `/deploy-targets/${t.id}?workspaceId=w1`)).status).toBe(204);
  });
});

describe("container image (ADR-0060, M18-T10)", () => {
  test("POST /projects/{id}/images runs the toolchain image job and answers its digest; a failed push is 422", async () => {
    const { createOrchestratorHandler } = await import("./app.ts");
    const { repo, s, project, gen } = await setup();
    const jobs: unknown[] = [];
    let ok = true;
    (s.clients as unknown as Record<string, unknown>).job = async (_l: string, kind: string, _p: string, onLine: (l: LogLine) => void, options: unknown) => {
      jobs.push({ kind, options });
      onLine({ runId: "j", seq: 0, ts: 1, stream: "stdout", level: "info", msg: "image: /app with 5 shared libraries" });
      if (ok) onLine({ runId: "j", seq: 1, ts: 2, stream: "stdout", level: "info", msg: 'SVIMAGE {"reference":"registry:5000/lka:1","digest":"sha256:abc","bytes":42,"files":7}' });
      else onLine({ runId: "j", seq: 1, ts: 2, stream: "stderr", level: "error", msg: "push failed: registry refused the manifest: 401" });
      return { id: "j", state: ok ? "succeeded" : "failed", exitCode: ok ? 0 : 1, diagnostics: [] };
    };
    const handler = createOrchestratorHandler({ repo, clients: s.clients, hub: new EventHub(), kick() {}, background() {} });
    const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }, requestId: "t" } as never;
    const call = (body: unknown) => handler(new Request(`http://o/projects/${p.id}/images`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ctx);
    const p = await project("lka");
    expect((await call({ reference: "registry:5000/lka:1" })).status).toBe(409); // no SynCode yet
    await gen(p);
    expect((await call({ reference: "not a ref" })).status).toBe(400);
    const res = await call({ reference: "registry:5000/lka:1", insecure: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reference: "registry:5000/lka:1", digest: "sha256:abc", bytes: 42 });
    expect(jobs).toEqual([{ kind: "image", options: { image: { reference: "registry:5000/lka:1", insecure: true } } }]);
    ok = false;
    const failed = await call({ reference: "registry:5000/lka:1", username: "u", password: "p" });
    expect(failed.status).toBe(422);
    expect((await failed.json()).message).toContain("401");
  });
});
