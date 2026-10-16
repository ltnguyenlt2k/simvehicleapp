import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Per-run vehicle sandbox (ADR-0057, M17-T04): a KUKSA databroker of its own, spawned by this agent next to the app,
 * loading the VSS file the project vendored (its own release, custom models included). Runs on different sandboxes
 * never see each other's signals, so several users and apps run at once. The broker is a child of the agent, which
 * waits for it to exit (no zombie: the spike showed PID 1 of the container does not reap orphans).
 */

export interface Sandbox {
  /** `host:port` other services of sv-internal reach the broker at. */
  address: string;
  /** `127.0.0.1:port` the app in this container connects to. */
  local: string;
  stop(): Promise<void>;
}

export interface SandboxProvider {
  start(project: string): Promise<Sandbox>;
}

export interface SandboxConfig {
  /** Databroker binary (copied from the KUKSA image into the toolchain image). */
  bin: string;
  /** Host name of this toolchain on sv-internal (`toolchain-cpp`…). */
  host: string;
  /** Inclusive port range of the brokers. */
  ports: [number, number];
  projectsDir: string;
  /** Milliseconds to wait for a broker to accept connections. */
  readyMs?: number;
}

export class SandboxError extends Error {}

/** `SV_SANDBOX_PORTS=56000-56199` ⇒ [56000, 56199]. */
export function parsePorts(spec: string | undefined, fallback: [number, number] = [56000, 56199]): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(spec ?? "");
  if (!m) return fallback;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo > 1024 && hi >= lo && hi < 65536 ? [lo, hi] : fallback;
}

/** The VSS file of the project's vehicle model, from its AppManifest (`vehicle-signal-interface` config `src`). */
export function projectVssFile(projectsDir: string, project: string): string {
  const dir = join(projectsDir, project);
  let manifest: { interfaces?: { type?: string; config?: { src?: unknown } }[] };
  try {
    manifest = JSON.parse(readFileSync(join(dir, "app", "AppManifest.json"), "utf8"));
  } catch {
    throw new SandboxError("the project has no app/AppManifest.json");
  }
  const src = manifest.interfaces?.find((i) => i.type === "vehicle-signal-interface")?.config?.src;
  if (typeof src !== "string" || !/^app\/vss\/[A-Za-z0-9._-]+\.json$/.test(src)) {
    throw new SandboxError("the AppManifest names no vendored VSS file (app/vss/*.json)");
  }
  return join(dir, src);
}

type Spawned = { pid: number; exited: Promise<number>; kill(signal?: number | NodeJS.Signals): void };

export interface ProcessDeps {
  spawn(argv: string[]): Spawned;
  /** Resolves when something accepts connections on 127.0.0.1:port. */
  probe(port: number): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

const realDeps: ProcessDeps = {
  spawn: (argv) => Bun.spawn(argv, { stdout: "ignore", stderr: "ignore" }),
  probe: (port) =>
    new Promise((resolve) => {
      Bun.connect({ hostname: "127.0.0.1", port, socket: { open: (s) => (s.end(), resolve(true)), error: () => resolve(false), data() {}, close() {} } }).catch(() => resolve(false));
    }),
  sleep: (ms) => Bun.sleep(ms),
};

/** Brokers spawned as processes of this agent, one port each. */
export class ProcessSandboxes implements SandboxProvider {
  private readonly used = new Set<number>();

  constructor(
    private readonly cfg: SandboxConfig,
    private readonly deps: ProcessDeps = realDeps,
  ) {}

  /** Brokers alive now (System status, tests). */
  get count(): number {
    return this.used.size;
  }

  async start(project: string): Promise<Sandbox> {
    const vss = projectVssFile(this.cfg.projectsDir, project);
    const port = await this.allocate();
    const proc = this.deps.spawn([this.cfg.bin, "--insecure", "--enable-databroker-v1", "--address", "0.0.0.0", "--port", String(port), "--worker-threads", "2", "--vss", vss]);
    let alive = true;
    void proc.exited.then(() => {
      alive = false;
    });
    const deadline = Date.now() + (this.cfg.readyMs ?? 5_000);
    while (!(await this.deps.probe(port))) {
      if (!alive || Date.now() > deadline) {
        proc.kill("SIGKILL");
        await proc.exited.catch(() => 0);
        this.used.delete(port);
        throw new SandboxError(alive ? `the vehicle databroker did not start on port ${port}` : "the vehicle databroker exited at start (VSS file rejected?)");
      }
      await this.deps.sleep(20);
    }
    let stopped: Promise<void> | null = null;
    return {
      address: `${this.cfg.host}:${port}`,
      local: `127.0.0.1:${port}`,
      stop: () => {
        stopped ??= (async () => {
          proc.kill("SIGTERM");
          const done = await Promise.race([proc.exited.then(() => true), this.deps.sleep(3_000).then(() => false)]);
          if (!done) {
            proc.kill("SIGKILL");
            await proc.exited.catch(() => 0);
          }
          this.used.delete(port);
        })();
        return stopped;
      },
    };
  }

  /** A port of the range neither this agent nor another process holds. */
  private async allocate(): Promise<number> {
    const [lo, hi] = this.cfg.ports;
    for (let p = lo; p <= hi; p++) {
      if (this.used.has(p)) continue;
      this.used.add(p);
      if (!(await this.deps.probe(p))) return p;
      this.used.delete(p);
    }
    throw new SandboxError(`no free sandbox port in ${lo}-${hi}`);
  }
}
