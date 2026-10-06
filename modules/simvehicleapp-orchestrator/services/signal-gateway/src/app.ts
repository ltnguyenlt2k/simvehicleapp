import { ContractValidator } from "@simvehicleapp/contracts";
import type { RequestContext } from "@simvehicleapp/service-kit";
import { type Broker, BrokerRejected, type BrokerUpdate, BrokerUnavailable, type Field } from "./broker.ts";
import type { Catalog, SignalMeta } from "./catalog.ts";
import type { Player, Scenario } from "./player.ts";
import { toDatapoint } from "./values.ts";

/**
 * HTTP surface of the signal-gateway (`openapi/signal-gateway.v1.yaml`): SSE of signal updates,
 * inject, actuator mirroring (target → current, the provider role in dev runs) and scenario playback.
 * Every path must belong to the release catalog (analysis/08 §4).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejected = (status: number, error: string, message: string) => json(status, { error, message });
const RELEASE = /^v[0-9]+\.[0-9]+$/;
const MAX_PATHS = 200;
const HEARTBEAT_MS = 15_000;
const validator = new ContractValidator();

export interface GatewayDeps {
  /** Databroker of a release (SV_DATABROKERS), or undefined when the stack has none for it. */
  broker(release: string): Broker | undefined;
  catalog: Catalog;
  player: Player;
  newId(): string;
  now?: () => number;
  heartbeatMs?: number;
}

type Resolved = { broker: Broker; signals: Map<string, SignalMeta> };

/** Mirrors actuator targets to current values for one release (replaced on each PUT /mirror). */
class Mirror {
  private cancel: (() => void) | null = null;
  paths: string[] = [];

  set(r: Resolved, paths: string[], log: RequestContext["log"]) {
    this.cancel?.();
    this.cancel = null;
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

  const resolve = async (release: string | null): Promise<Resolved | Response> => {
    if (!release || !RELEASE.test(release)) return rejected(400, "invalid_request", "release (vX.Y) is required");
    const broker = d.broker(release);
    if (!broker) return rejected(503, "no_databroker", `the stack has no databroker for VSS ${release}`);
    try {
      return { broker, signals: await d.catalog.signals(release) };
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
      const r = await resolve(q.get("release"));
      if (r instanceof Response) return r;
      const paths = pathList();
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
      const r = await resolve(q.get("release"));
      if (r instanceof Response) return r;
      const paths = pathList();
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
      const b = (await req.json().catch(() => null)) as { release?: string; path?: string; value?: unknown; field?: Field } | null;
      if (!b || typeof b.path !== "string" || !("value" in b) || (b.field !== "value" && b.field !== "target")) return rejected(400, "invalid_request", "release, path, value and field (value|target) are required");
      const r = await resolve(b.release ?? null);
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
      const b = (await req.json().catch(() => null)) as { release?: string; paths?: unknown } | null;
      if (!b || !Array.isArray(b.paths) || !b.paths.every((p) => typeof p === "string")) return rejected(400, "invalid_request", "release and paths are required");
      const r = await resolve(b.release ?? null);
      if (r instanceof Response) return r;
      const paths = [...new Set(b.paths as string[])];
      const notActuator = paths.find((p) => r.signals.get(p)?.type !== "actuator");
      if (notActuator) return rejected(400, "invalid_request", `${notActuator} is not an actuator of VSS ${b.release}`);
      const m = mirrors.get(b.release!) ?? new Mirror();
      mirrors.set(b.release!, m);
      m.set(r, paths, ctx.log);
      ctx.log.info("mirror updated", { release: b.release, paths: paths.length });
      return new Response(null, { status: 204 });
    }

    if (url.pathname === "/play") {
      if (req.method === "GET") return d.player.playback ? json(200, d.player.playback) : rejected(404, "not_found", "nothing played yet");
      if (req.method === "DELETE") {
        d.player.stop();
        return new Response(null, { status: 204 });
      }
      if (req.method === "POST") {
        const b = (await req.json().catch(() => null)) as { release?: string; scenario?: Scenario } | null;
        if (!b?.scenario || !validator.validate("scenario", b.scenario).valid) return rejected(400, "invalid_request", "release and a scenario v1 are required");
        const r = await resolve(b.release ?? null);
        if (r instanceof Response) return r;
        // Every signal value is checked before anything is written.
        const sets = [...Object.entries(b.scenario.initial ?? {}).map(([path, value]) => ({ path, value })), ...b.scenario.inputs.filter((i) => i.path).map((i) => ({ path: i.path!, value: i.value }))];
        for (const s of sets) {
          const meta = r.signals.get(s.path);
          if (!meta) return rejected(400, "invalid_request", `${s.path} is not a signal of VSS ${b.release}`);
          const dp = toDatapoint(meta, s.value);
          if (!dp.ok) return rejected(400, "invalid_value", dp.message);
        }
        const { playback } = d.player.play(d.newId(), b.release!, b.scenario);
        ctx.log.info("scenario playing", { release: b.release, name: b.scenario.name, inputs: playback.total });
        return json(202, playback);
      }
    }
    return rejected(404, "not_found", "not found");
  };
}

/** The player's writes: through the same checks as an inject. */
export function playerSet(broker: (release: string) => Broker | undefined, catalog: Catalog) {
  return async (release: string, path: string, field: Field, value: unknown) => {
    const b = broker(release);
    if (!b) throw new Error(`no databroker for VSS ${release}`);
    const meta = (await catalog.signals(release)).get(path);
    if (!meta) throw new Error(`${path} is not a signal of VSS ${release}`);
    const dp = toDatapoint(meta, value);
    if (!dp.ok) throw new Error(dp.message);
    await b.set(path, field, dp.datapoint);
  };
}
