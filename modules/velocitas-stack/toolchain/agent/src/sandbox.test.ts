import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JobManager } from "./jobs.ts";
import { type ProcessDeps, ProcessSandboxes, parsePorts, projectVssFile, type SandboxProvider } from "./sandbox.ts";

const dir = join(import.meta.dir, ".test-sandbox");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function project(slug: string, src = "app/vss/vss_rel_4.0.json") {
  mkdirSync(join(dir, slug, "app", "vss"), { recursive: true });
  writeFileSync(join(dir, slug, "app", "AppManifest.json"), JSON.stringify({ manifestVersion: "v3", interfaces: [{ type: "vehicle-signal-interface", config: { src } }] }));
}

/** A fake broker process: ready after `readyAfter` probes, exits on kill. */
function fakeDeps(opts: { readyAfter?: number; dies?: boolean; busy?: number[] } = {}) {
  const spawned: string[][] = [];
  const killed: string[] = [];
  const alive = new Set<string>();
  let probes = 0;
  const deps: ProcessDeps = {
    spawn(argv) {
      spawned.push(argv);
      const port = argv[argv.indexOf("--port") + 1]!;
      alive.add(port);
      let exit!: (c: number) => void;
      const exited = new Promise<number>((r) => (exit = r)).then((c) => (alive.delete(port), c));
      if (opts.dies) setTimeout(() => exit(1), 1);
      return { pid: 1, exited, kill: (s) => (killed.push(String(s)), exit(0)) };
    },
    probe: async (port) => {
      if (opts.busy?.includes(port)) return true;
      // Free until a broker was spawned on it; then ready after `readyAfter` probes.
      if (!alive.has(String(port))) return false;
      return ++probes > (opts.readyAfter ?? 0);
    },
    sleep: (ms) => Bun.sleep(Math.min(ms, 2)),
  };
  return { deps, spawned, killed };
}

describe("per-run sandbox (ADR-0057)", () => {
  test("ports spec; the project's vendored VSS file from its AppManifest", () => {
    expect(parsePorts("56000-56010")).toEqual([56000, 56010]);
    expect(parsePorts("bad")).toEqual([56000, 56199]);
    expect(parsePorts("80-90")).toEqual([56000, 56199]);
    project("p1", "app/vss/vss_rel_4.0-acme.json");
    expect(projectVssFile(dir, "p1")).toBe(join(dir, "p1", "app/vss/vss_rel_4.0-acme.json"));
    project("p2", "../../etc/passwd");
    expect(() => projectVssFile(dir, "p2")).toThrow("names no vendored VSS file");
    expect(() => projectVssFile(dir, "missing")).toThrow("no app/AppManifest.json");
  });

  test("a broker per run on its own port, skipping ports another process holds; stop frees the port", async () => {
    project("p1");
    const { deps, spawned, killed } = fakeDeps({ busy: [56000] });
    const sb = new ProcessSandboxes({ bin: "/bin/db", host: "toolchain-cpp", ports: [56000, 56002], projectsDir: dir }, deps);
    const a = await sb.start("p1");
    const b = await sb.start("p1");
    expect([a.address, b.address]).toEqual(["toolchain-cpp:56001", "toolchain-cpp:56002"]);
    expect(a.local).toBe("127.0.0.1:56001");
    expect(spawned[0]).toEqual(["/bin/db", "--insecure", "--enable-databroker-v1", "--address", "0.0.0.0", "--port", "56001", "--worker-threads", "2", "--vss", join(dir, "p1", "app/vss/vss_rel_4.0.json")]);
    await expect(sb.start("p1")).rejects.toThrow("no free sandbox port");
    await a.stop();
    await a.stop();
    expect(killed).toEqual(["SIGTERM"]);
    expect(sb.count).toBe(1);
    expect((await sb.start("p1")).address).toBe("toolchain-cpp:56001");
  });

  test("a broker that exits at start (VSS rejected) is reported and its port freed", async () => {
    project("p1");
    const { deps } = fakeDeps({ dies: true, readyAfter: 1000 });
    const sb = new ProcessSandboxes({ bin: "/bin/db", host: "t", ports: [56000, 56000], projectsDir: dir, readyMs: 200 }, deps);
    await expect(sb.start("p1")).rejects.toThrow("exited at start");
    expect(sb.count).toBe(0);
  });
});

describe("runs with sandboxes in the job queue", () => {
  // Like the real planner: the run's environment goes to its step.
  const planner = (_k: string, _p: string, options: { env?: Record<string, string> }) => ({
    steps: [{ label: "app", argv: ["sh", "-c", "echo $SDV_VEHICLEDATABROKER_ADDRESS; sleep 30"], cwd: "/", env: options.env }],
    failCode: "RUN_CRASHED",
    failStage: "run",
  });

  test("several sandboxed runs at once, each told its own broker; the sandbox stops with the run", async () => {
    const stopped: string[] = [];
    let n = 0;
    const sandboxes: SandboxProvider = {
      start: async () => {
        const p = 56001 + n++;
        return { address: `toolchain-cpp:${p}`, local: `127.0.0.1:${p}`, stop: async () => void stopped.push(String(p)) };
      },
    };
    const jobs = new JobManager(planner, undefined, undefined, undefined, sandboxes, 2);
    const r1 = jobs.create("run", "p1", { sandbox: true });
    const r2 = jobs.create("run", "p2", { sandbox: true });
    expect(() => jobs.create("run", "p3", { sandbox: true })).toThrow("2 runs are already active");
    await Bun.sleep(150);
    expect(jobs.get(r1.id)?.sandbox).toEqual({ address: "toolchain-cpp:56001" });
    expect(jobs.lines(r2.id).some((l) => l.msg === "grpc://127.0.0.1:56002")).toBe(true);
    jobs.create("stop", "p1", { runJobId: r1.id });
    await Bun.sleep(150);
    expect(jobs.get(r1.id)?.state).toBe("cancelled");
    expect(stopped).toEqual(["56001"]);
    jobs.create("stop", "p2", { runJobId: r2.id });
    await Bun.sleep(150);
  });

  test("a shared-broker run stays single; sandboxed runs are refused without a provider", () => {
    const jobs = new JobManager(planner);
    const r = jobs.create("run", "p1");
    expect(() => jobs.create("run", "p2")).toThrow("a run is already active");
    expect(() => jobs.create("run", "p2", { sandbox: true })).toThrow("not enabled");
    jobs.create("stop", "p1", { runJobId: r.id });
  });

  test("a sandbox that cannot start fails the run with a diagnostic", async () => {
    const jobs = new JobManager(planner, undefined, undefined, undefined, { start: async () => { throw new Error("no free sandbox port in 1-1"); } });
    const r = jobs.create("run", "p1", { sandbox: true });
    await Bun.sleep(50);
    expect(jobs.get(r.id)?.state).toBe("failed");
    expect(jobs.get(r.id)?.diagnostics[0]).toMatchObject({ code: "RUN_CRASHED", data: { sandbox: true } });
  });
});
