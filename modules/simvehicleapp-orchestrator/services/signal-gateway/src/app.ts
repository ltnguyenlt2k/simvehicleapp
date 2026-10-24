import { ContractValidator } from "@simvehicleapp/contracts";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { type Broker, BrokerRejected, type BrokerUpdate, BrokerUnavailable, type Field } from "./broker.ts";
import type { Catalog, SignalMeta } from "./catalog.ts";
import type { Playback, Player, Scenario } from "./player.ts";
import { type Provider, type ProviderApi, ProviderRejected, provideActuators } from "./provider.ts";
import type { Subscribe } from "./mqtt.ts";
import { toDatapoint } from "./values.ts";

/**
 * HTTP surface of the signal-gateway (`openapi/signal-gateway.v1.yaml`): SSE of signal updates,
 * inject, actuator mirroring (target → current, the provider role in dev runs) and scenario playback.
 * Every path must belong to the release catalog (analysis/08 §4). With `sandbox` (ADR-0057, M17-T05) a call goes to the
 * databroker of one run (`toolchain-<lang>:<port>`) instead of the release's shared one; mirrors and playbacks are per
 * sandbox, so runs of several users never touch each other's signals.
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejected = (status: number, error: string, message: string) => json(status, { error, message });
const simulatedInputDisabled = (sandbox: string) =>
  rejected(409, "SIMULATED_INPUT_DISABLED", `the app is deployed (${sandbox}): its signals come from the deploy target, simulated input is disabled`);
const RELEASE = /^v[0-9]+\.[0-9]+(-[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?)?$/;
/** A run's own databroker (ADR-0057), or a deployment's route to its deploy target (ADR-0060). */
const SANDBOX = /^(toolchain-(cpp|python|rust)|vehicle-gateway):[0-9]{2,5}$/;
/** A deployment: its signals come from the target's layers, never from SimVehicleApp (no inject, play or mirror). */
const DEPLOYED = /^vehicle-gateway:[0-9]{2,5}$/;
const SANDBOX_HELP = "sandbox must be toolchain-<lang>:<port> or vehicle-gateway:<port>";
const MAX_PATHS = 200;
const TOPIC_PREFIX = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\/?$/;
const HEARTBEAT_MS = 15_000;
const validator = new ContractValidator();

export interface GatewayDeps {
  /** Databroker of a release (SV_DATABROKERS) or of a run's sandbox; undefined when the stack has none for it. */
  broker(release: string, sandbox?: string): Broker | undefined;
  /** The run ended (its mirror was cleared): close the connection to its sandbox. */
  forget?(sandbox: string): void;
  catalog: Catalog;
  /** Playbacks on the shared databrokers. */
  player: Player;
  /** Playbacks on a run's sandbox (one player per sandbox). */
  sandboxPlayer?(sandbox: string): Player;
  /** MQTT subscription (Messages, ADR-0058 §6). */
  subscribe?: Subscribe;
  /** `kuksa.val.v2` of the databroker of a release or sandbox: the gateway provides the actuators of a v2 app (ADR-0047). */
  providerApi?(release: string, sandbox?: string): ProviderApi | undefined;
  newId(): string;
  now?: () => number;
  heartbeatMs?: number;
}

type Resolved = { broker: Broker; signals: Map<string, SignalMeta> };

/** Mirrors actuator targets to current values for one release (replaced on each PUT /mirror). */
class Mirror {
  private cancel: (() => void) | null = null;
  paths: string[] = [];

  private provider: Provider | null = null;

  clear() {
    this.cancel?.();
    this.cancel = null;
    this.provider?.stop();
    this.provider = null;
    this.paths = [];
  }

  /** A v2 app: provide its actuators (each actuation is accepted and published as the current value). */
  private publishing = true;

  async provide(api: ProviderApi, paths: string[], log: RequestContext["log"], publish = true) {
    const same = this.provider && this.paths.length === paths.length && paths.every((p) => this.paths.includes(p));
    if (same) {
      // Same actuators: keep the claim (a re-claim leaves a gap where the app's writes are refused).
      this.provider!.setPublish(publish);
      this.publishing = publish;
      return;
    }
    const hadOwn = Boolean(this.provider);
    this.clear();
    this.paths = paths;
    this.publishing = publish;
    if (!paths.length) return;
    // The databroker frees our previous claim a moment after its stream closes: retry ALREADY_EXISTS briefly then.
    for (let attempt = 0; ; attempt++) {
      try {
        this.provider = await provideActuators(api, paths, log, (e) => log.warn("provider stream ended", { err: e.message }), publish);
        return;
      } catch (e) {
        if (!hadOwn || attempt >= 10 || !(e instanceof ProviderRejected) || !e.message.startsWith("another provider")) throw e;
        await Bun.sleep(100);
      }
    }
  }

  set(r: Resolved, paths: string[], log: RequestContext["log"]) {
    this.clear();
    this.paths = paths;
    if (!paths.length) return;
    this.cancel = r.broker.subscribe(
      [],
      paths,
      (updates) => {
        for (const u of updates) {
          const meta = r.signals.get(u.path);
          const dp = meta && toDatapoint(meta, u.value);
          if (dp?.ok) r.broker.set(u.path, "value", dp.datapoint).catch((e) => log.warn("mirror write failed", { path: u.path, err: (e as Error).message }));
        }
      },
      (e) => log.warn("mirror subscription ended", { err: e.message }),
    );
  }
}

export function createGatewayHandler(d: GatewayDeps) {
  const now = d.now ?? Date.now;
  const mirrors = new Map<string, Mirror>();
  const players = new Map<string, Player>();
  const playerOf = (sandbox: string | undefined): Player | Response => {
    if (!sandbox) return d.player;
    if (!SANDBOX.test(sandbox)) return rejected(400, "invalid_request", SANDBOX_HELP);
    if (!d.sandboxPlayer) return rejected(503, "no_databroker", "sandboxed runs are not enabled in this gateway");
    let p = players.get(sandbox);
    if (!p) players.set(sandbox, (p = d.sandboxPlayer(sandbox)));
    return p;
  };

  const resolve = async (release: string | null, paths: readonly string[] = [], sandbox?: string | null): Promise<Resolved | Response> => {
    if (!release || !RELEASE.test(release)) return rejected(400, "invalid_request", "release (vX.Y or vX.Y-<name>) is required");
    if (sandbox != null && !SANDBOX.test(sandbox)) return rejected(400, "invalid_request", SANDBOX_HELP);
    const broker = d.broker(release, sandbox ?? undefined);
    if (!broker) return rejected(503, "no_databroker", sandbox ? `the run's databroker ${sandbox} is not reachable` : `the stack has no databroker for VSS ${release}`);
    try {
      return { broker, signals: await d.catalog.signalsWith(release, paths) };
    } catch (e) {
      return rejected(503, "catalog_unavailable", `VSS ${release} catalog is unavailable: ${(e as Error).message}`);
    }
  };
  const checkPaths = (r: Resolved, paths: string[]): string | null => {
    if (!paths.length) return "paths is required";
    if (paths.length > MAX_PATHS) return `at most ${MAX_PATHS} paths`;
    const unknown = paths.find((p) => !r.signals.has(p));
    return unknown ? `${unknown} is not a signal of this VSS release` : null;
  };
  const actuators = (r: Resolved, paths: string[]) => paths.filter((p) => r.signals.get(p)?.type === "actuator");
  const brokerError = (e: unknown) =>
    e instanceof BrokerUnavailable ? rejected(503, "databroker_unavailable", e.message) : e instanceof BrokerRejected ? rejected(422, "rejected", `the databroker refused the value: ${e.message}`) : null;

  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const q = url.searchParams;
    const pathList = () => [...new Set((q.get("paths") ?? "").split(",").map((p) => p.trim()).filter(Boolean))];

    if (url.pathname === "/signals" && req.method === "GET") {
      const paths = pathList();
      const r = await resolve(q.get("release"), paths, q.get("sandbox"));
      if (r instanceof Response) return r;
      const bad = checkPaths(r, paths);
      if (bad) return rejected(400, "invalid_request", bad);
      const targets = actuators(r, paths);
      const enc = new TextEncoder();
      let stop = () => {};
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          const send = (event: string, data: unknown) => {
            if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const close = () => {
            if (closed) return;
            closed = true;
            stop();
            controller.close();
          };
          const emit = (updates: BrokerUpdate[]) => {
            for (const u of updates) send("signal", { path: u.path, ts: u.ts, value: u.value, field: u.field });
          };
          // Subscribe first, then read the current values: a change in between is not lost.
          const cancel = r.broker.subscribe(paths, targets, emit, (e) => {
            send("error", { error: "databroker_unavailable", message: e.message });
            close();
          });
          const beat = setInterval(() => !closed && controller.enqueue(enc.encode(": keep-alive\n\n")), d.heartbeatMs ?? HEARTBEAT_MS);
          stop = () => {
            clearInterval(beat);
            cancel();
          };
          req.signal.addEventListener("abort", close);
          try {
            emit(await r.broker.get(paths, targets));
          } catch (e) {
            send("error", { error: "databroker_unavailable", message: (e as Error).message });
            close();
          }
        },
        cancel: () => {
          closed = true;
          stop();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    }

    if (url.pathname === "/snapshot" && req.method === "GET") {
      const paths = pathList();
      const r = await resolve(q.get("release"), paths, q.get("sandbox"));
      if (r instanceof Response) return r;
      const bad = checkPaths(r, paths);
      if (bad) return rejected(400, "invalid_request", bad);
      try {
        const updates = await r.broker.get(paths, actuators(r, paths));
        return json(200, { updates: updates.map((u) => ({ path: u.path, ts: u.ts, value: u.value, field: u.field })) });
      } catch (e) {
        return brokerError(e) ?? Promise.reject(e);
      }
    }

    if (url.pathname === "/signals" && req.method === "POST") {
      const b = (await req.json().catch(() => null)) as { release?: string; sandbox?: string; path?: string; value?: unknown; field?: Field } | null;
      if (!b || typeof b.path !== "string" || !("value" in b) || (b.field !== "value" && b.field !== "target")) return rejected(400, "invalid_request", "release, path, value and field (value|target) are required");
      if (b.sandbox && DEPLOYED.test(b.sandbox)) return simulatedInputDisabled(b.sandbox);
      const r = await resolve(b.release ?? null, [b.path], b.sandbox);
      if (r instanceof Response) return r;
      const meta = r.signals.get(b.path);
      if (!meta) return rejected(400, "invalid_request", `${b.path} is not a signal of VSS ${b.release}`);
      if (b.field === "target" && meta.type !== "actuator") return rejected(400, "invalid_request", `${b.path} is a ${meta.type}: only actuators have a target`);
      const dp = toDatapoint(meta, b.value);
      if (!dp.ok) return rejected(400, "invalid_value", dp.message);
      try {
        await r.broker.set(b.path, b.field, dp.datapoint);
      } catch (e) {
        return brokerError(e) ?? Promise.reject(e);
      }
      ctx.log.info("signal injected", { path: b.path, field: b.field });
      return json(200, { path: b.path, ts: now(), value: b.value, field: b.field });
    }

    if (url.pathname === "/mirror" && req.method === "PUT") {
      const b = (await req.json().catch(() => null)) as { release?: string; sandbox?: string; paths?: unknown; api?: string; publish?: boolean } | null;
      if (!b || !Array.isArray(b.paths) || !b.paths.every((p) => typeof p === "string")) return rejected(400, "invalid_request", "release and paths are required");
      if (b.api !== undefined && b.api !== "sdv.databroker.v1" && b.api !== "kuksa.val.v2") return rejected(400, "invalid_request", "api must be sdv.databroker.v1 or kuksa.val.v2");
      const paths = [...new Set(b.paths as string[])];
      if (b.sandbox && paths.length && DEPLOYED.test(b.sandbox)) return simulatedInputDisabled(b.sandbox);
      const key = b.sandbox ?? b.release!;
      if (b.sandbox && !paths.length) {
        // The run ended: stop its mirror and playback and drop the connection to its databroker.
        if (!SANDBOX.test(b.sandbox)) return rejected(400, "invalid_request", SANDBOX_HELP);
        mirrors.get(key)?.clear();
        mirrors.delete(key);
        players.get(key)?.stop();
        players.delete(key);
        d.forget?.(b.sandbox);
        ctx.log.info("sandbox released", { sandbox: b.sandbox });
        return new Response(null, { status: 204 });
      }
      const r = await resolve(b.release ?? null, paths, b.sandbox);
      if (r instanceof Response) return r;
      const notActuator = paths.find((p) => r.signals.get(p)?.type !== "actuator");
      if (notActuator) return rejected(400, "invalid_request", `${notActuator} is not an actuator of VSS ${b.release}`);
      const m = mirrors.get(key) ?? new Mirror();
      mirrors.set(key, m);
      if (b.api === "kuksa.val.v2") {
        // The app actuates over kuksa.val.v2: provide its actuators instead of mirroring targets (ADR-0047 §2, §5).
        const api = d.providerApi?.(b.release!, b.sandbox);
        if (!api) return rejected(503, "no_databroker", "kuksa.val.v2 is not available for this databroker");
        try {
          await m.provide(api, paths, ctx.log, b.publish !== false);
        } catch (e) {
          m.clear();
          return rejected(409, "provider_refused", (e as Error).message);
        }
      } else m.set(r, paths, ctx.log);
      ctx.log.info("mirror updated", { release: b.release, ...(b.sandbox ? { sandbox: b.sandbox } : {}), api: b.api ?? "sdv.databroker.v1", paths: paths.length });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/messages" && req.method === "GET") {
      // The MQTT messages of an app (its topic prefix): HMI notifications and other publishes, as SSE (ADR-0058 §6).
      const prefix = q.get("prefix") ?? "";
      if (!TOPIC_PREFIX.test(prefix)) return rejected(400, "invalid_request", "prefix: a topic prefix (letters, digits, - _ /)");
      if (!d.subscribe) return rejected(503, "mqtt_unavailable", "MQTT is not configured");
      const subscribe = d.subscribe;
      const enc = new TextEncoder();
      let stop = () => {};
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const send = (event: string, data: unknown) => {
            if (!closed) controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const close = () => {
            if (closed) return;
            closed = true;
            stop();
            controller.close();
          };
          const cancel = subscribe(
            `${prefix.replace(/\/$/, "")}/#`,
            (topic, payload) => send("message", { topic, payload, ts: now() }),
            (e) => {
              send("error", { error: "mqtt_unavailable", message: e.message });
              close();
            },
          );
          const beat = setInterval(() => !closed && controller.enqueue(enc.encode(": keep-alive\n\n")), d.heartbeatMs ?? HEARTBEAT_MS);
          stop = () => {
            clearInterval(beat);
            cancel();
          };
          req.signal.addEventListener("abort", close);
        },
        cancel: () => {
          closed = true;
          stop();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
    }

    if (url.pathname === "/play") {
      if (req.method === "GET" || req.method === "DELETE") {
        const p = playerOf(q.get("sandbox") ?? undefined);
        if (p instanceof Response) return p;
        if (req.method === "GET") return p.playback ? json(200, p.playback) : rejected(404, "not_found", "nothing played yet");
        p.stop();
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST") {
        const b = (await req.json().catch(() => null)) as { release?: string; sandbox?: string; scenario?: Scenario; observe?: unknown } | null;
        if (!b?.scenario || !validator.validate("scenario", b.scenario).valid) return rejected(400, "invalid_request", "release and a scenario v1 are required");
        if (b.sandbox && DEPLOYED.test(b.sandbox)) return simulatedInputDisabled(b.sandbox);
        const observe = b.observe === undefined ? [] : b.observe;
        if (!Array.isArray(observe) || observe.length > MAX_PATHS || !observe.every((p) => typeof p === "string")) return rejected(400, "invalid_request", `observe: at most ${MAX_PATHS} signal paths`);
        // Every signal value is checked before anything is written.
        const sets = [...Object.entries(b.scenario.initial ?? {}).map(([path, value]) => ({ path, value })), ...b.scenario.inputs.filter((i) => i.path).map((i) => ({ path: i.path!, value: i.value }))];
        const r = await resolve(b.release ?? null, [...sets.map((x) => x.path), ...(observe as string[])], b.sandbox);
        if (r instanceof Response) return r;
        const unknown = (observe as string[]).find((p) => !r.signals.has(p));
        if (unknown) return rejected(400, "invalid_request", `${unknown} is not a signal of VSS ${b.release}`);
        const player = playerOf(b.sandbox);
        if (player instanceof Response) return player;
        for (const s of sets) {
          const meta = r.signals.get(s.path);
          if (!meta) return rejected(400, "invalid_request", `${s.path} is not a signal of VSS ${b.release}`);
          const dp = toDatapoint(meta, s.value);
          if (!dp.ok) return rejected(400, "invalid_value", dp.message);
        }
        const { playback, finished } = player.play(d.newId(), b.release!, b.scenario);
        if ((observe as string[]).length) watch(r, player, playback, b.scenario, observe as string[], finished, ctx.log);
        ctx.log.info("scenario playing", { release: b.release, name: b.scenario.name, inputs: playback.total, observe: (observe as string[]).length });
        return json(202, playback);
      }
    }
    return rejected(404, "not_found", "not found");
  };
}

/**
 * Records what the app does during a playback (ADR-0058 §4, Play on the vehicle stack): target and current changes of
 * the observed signals, in ms from the playback's start. Changes of a value the playback itself set (its initial
 * values and inputs, within 250 ms of their time) are not the app's: they are left out. Stops 1 s after the playback
 * ends, at the scenario's `until`.
 */
function watch(r: Resolved, player: Player, playback: Playback, scenario: Scenario, paths: string[], finished: Promise<Playback>, log: RequestContext["log"]) {
  const own = [
    ...Object.entries(scenario.initial ?? {}).map(([path, value]) => ({ t: 0, path, value })),
    ...scenario.inputs.flatMap((i) => (i.path ? [{ t: i.t, path: i.path, value: i.value }] : [])),
  ];
  const targets = actuatorsOf(r, paths);
  const cancel = r.broker.subscribe(
    paths,
    targets,
    (updates) => {
      for (const u of updates) {
        // The subscription first reports each signal's current value, stamped when it was set: older is not the app's.
        if (u.ts < playback.startedAt) continue;
        const t = u.ts - playback.startedAt;
        const set = u.field === "value" && own.some((o) => o.path === u.path && JSON.stringify(o.value) === JSON.stringify(u.value) && Math.abs(o.t - t) <= 250);
        if (!set) player.record(playback.id, { t, path: u.path, field: u.field, value: u.value });
      }
    },
    (e) => log.warn("play: observing stopped", { err: e.message }),
  );
  void finished.then(() => setTimeout(cancel, 1000));
}

const actuatorsOf = (r: Resolved, paths: string[]) => paths.filter((p) => r.signals.get(p)?.type === "actuator");

/** The player's writes: through the same checks as an inject (a sandbox player's `broker` answers the run's databroker). */
export function playerSet(broker: (release: string) => Broker | undefined, catalog: Catalog) {
  return async (release: string, path: string, field: Field, value: unknown) => {
    const b = broker(release);
    if (!b) throw new Error(`no databroker for VSS ${release}`);
    const meta = (await catalog.signalsWith(release, [path])).get(path);
    if (!meta) throw new Error(`${path} is not a signal of VSS ${release}`);
    const dp = toDatapoint(meta, value);
    if (!dp.ok) throw new Error(dp.message);
    await b.set(path, field, dp.datapoint);
  };
}
