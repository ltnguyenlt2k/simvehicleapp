import type { RequestContext } from "@simvehicleapp/service-kit";
import { fields, stringMessage } from "./protobuf.ts";
import { Route, type RouteConfig, type RouteDeps } from "./route.ts";

/**
 * vehicle-gateway control API (openapi/vehicle-gateway.v1.yaml, ADR-0060): the orchestrator opens a route per
 * deployment (PUT /routes/{id}) and gives its address to the deployed app as its databroker; closes it when the
 * deployment stops; reads its audit; probes a deploy target (Test connection).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejected = (status: number, error: string, message: string) => json(status, { error, message });

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TARGET = /^[A-Za-z0-9.-]{1,253}:[0-9]{2,5}$/;
const PATH = /^Vehicle(\.[A-Za-z0-9_]+)+$/;
const MAX_ACTUATORS = 200;

export interface GatewayDeps extends RouteDeps {
  /** Ports the routes listen on (`SV_VEHICLE_GATEWAY_PORTS`). */
  ports: { from: number; to: number };
  /** Host name the apps reach the gateway by (`vehicle-gateway` on sv-internal). */
  host: string;
  /** Interface the routes listen on. */
  listen?: string;
}

interface TargetBody {
  target?: unknown;
  tls?: unknown;
  token?: unknown;
}

function targetOf(b: TargetBody): Pick<RouteConfig, "target" | "tls" | "token"> | string {
  if (typeof b.target !== "string" || !TARGET.test(b.target)) return "target must be host:port";
  if (b.tls !== undefined && typeof b.tls !== "boolean") return "tls must be a boolean";
  if (b.token !== undefined && (typeof b.token !== "string" || b.token.length > 4096)) return "token must be a string";
  return { target: b.target, tls: b.tls === true, ...(b.token ? { token: b.token as string } : {}) };
}

export function createVehicleGatewayHandler(d: GatewayDeps) {
  const routes = new Map<string, { route: Route; port: number }>();
  const used = () => new Set([...routes.values()].map((r) => r.port));

  const open = async (config: RouteConfig): Promise<number> => {
    const taken = used();
    for (let port = d.ports.from; port <= d.ports.to; port++) {
      if (taken.has(port)) continue;
      const route = new Route(config, d);
      try {
        await route.start(port, d.listen);
      } catch {
        await route.close();
        continue; // in use by something else
      }
      routes.set(config.id, { route, port });
      return port;
    }
    throw new Error("no free route port");
  };

  return async (req: Request, ctx: RequestContext): Promise<Response> => {
    const url = new URL(req.url);
    const m = /^\/routes\/([^/]+)(\/audit)?$/.exec(url.pathname);

    if (m && !m[2] && req.method === "PUT") {
      const id = decodeURIComponent(m[1]!);
      if (!ID.test(id)) return rejected(400, "invalid_request", "route id: letters, digits, _ and -");
      const b = (await req.json().catch(() => null)) as (TargetBody & { mode?: unknown; actuators?: unknown }) | null;
      if (!b) return rejected(400, "invalid_request", "JSON body required");
      const t = targetOf(b);
      if (typeof t === "string") return rejected(400, "invalid_request", t);
      if (b.mode !== "read-only" && b.mode !== "read-write") return rejected(400, "invalid_request", "mode must be read-only or read-write");
      const actuators = b.actuators ?? [];
      if (!Array.isArray(actuators) || actuators.length > MAX_ACTUATORS || !actuators.every((p) => typeof p === "string" && PATH.test(p)))
        return rejected(400, "invalid_request", `actuators: at most ${MAX_ACTUATORS} VSS paths`);
      const old = routes.get(id);
      if (old) {
        routes.delete(id);
        await old.route.close();
      }
      try {
        const port = await open({ id, ...t, mode: b.mode, actuators: [...new Set(actuators as string[])].sort() });
        ctx.log.info("route opened", { id, target: t.target, tls: t.tls, mode: b.mode, port });
        return json(200, { id, address: `${d.host}:${port}`, port, mode: b.mode });
      } catch (e) {
        return rejected(503, "no_route_port", (e as Error).message);
      }
    }

    if (m && !m[2] && req.method === "DELETE") {
      const id = decodeURIComponent(m[1]!);
      const r = routes.get(id);
      if (!r) return rejected(404, "not_found", `no route ${id}`);
      routes.delete(id);
      await r.route.close();
      ctx.log.info("route closed", { id });
      return new Response(null, { status: 204 });
    }

    if (m && m[2] && req.method === "GET") {
      const r = routes.get(decodeURIComponent(m[1]!));
      if (!r) return rejected(404, "not_found", `no route ${m[1]}`);
      return json(200, { audit: r.route.audit, forwarded: Object.fromEntries(r.route.forwarded) });
    }

    if (url.pathname === "/routes" && req.method === "GET") {
      return json(200, {
        routes: [...routes.entries()].map(([id, r]) => ({ id, address: `${d.host}:${r.port}`, target: r.route.config.target, mode: r.route.config.mode })),
      });
    }

    if (url.pathname === "/probe" && req.method === "POST") {
      const b = (await req.json().catch(() => null)) as (TargetBody & { paths?: unknown }) | null;
      if (!b) return rejected(400, "invalid_request", "JSON body required");
      const t = targetOf(b);
      if (typeof t === "string") return rejected(400, "invalid_request", t);
      const paths = b.paths ?? [];
      if (!Array.isArray(paths) || paths.length > MAX_ACTUATORS || !paths.every((p) => typeof p === "string" && PATH.test(p)))
        return rejected(400, "invalid_request", `paths: at most ${MAX_ACTUATORS} VSS paths`);
      // A route that never listens: the same connection, TLS and token as a deployment would use.
      const probe = new Route({ id: "probe", ...t, mode: "read-only", actuators: [] }, d);
      try {
        const info = await probe.unary("/kuksa.val.v2.VAL/GetServerInfo", new Uint8Array());
        if (info.status !== 0) return json(200, { reachable: false, status: info.status, message: info.message ?? "no answer" });
        const f = info.body[0] ? fields(info.body[0]) : [];
        const text = (no: number) => {
          const v = f.find((x) => x.no === no)?.bytes;
          return v ? new TextDecoder().decode(v) : undefined;
        };
        const missing: string[] = [];
        for (const p of paths as string[]) {
          const r = await probe.unary("/kuksa.val.v2.VAL/ListMetadata", stringMessage(1, p));
          if (r.status !== 0 || !r.body.some((x) => x.length > 0)) missing.push(p);
        }
        return json(200, { reachable: true, api: "kuksa.val.v2", server: { name: text(1), version: text(2) }, missing });
      } finally {
        await probe.close();
      }
    }

    return rejected(404, "not_found", "not found");
  };
}
