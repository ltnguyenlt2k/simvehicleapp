import { afterEach, describe, expect, test } from "bun:test";
import { createVehicleGatewayHandler } from "./app.ts";
import { actuateByPath, call, fakeTarget, HAZARD } from "./test-helpers.ts";

const log = { info: () => {}, warn: () => {} };
const ctx = { log, requestId: "t" } as never;
const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

function gateway(from = 47100) {
  const handler = createVehicleGatewayHandler({ log, ports: { from, to: from + 2 }, host: "vehicle-gateway", listen: "127.0.0.1" });
  const req = (method: string, path: string, body?: unknown) =>
    handler(new Request(`http://g${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) }), ctx);
  return { req };
}

describe("vehicle-gateway control API (M18-T09)", () => {
  test("PUT a route ⇒ its address; the app's calls go through it; replaced, listed, audited, deleted", async () => {
    const t = await fakeTarget();
    cleanups.push(t.close);
    const g = gateway();
    const bad = await g.req("PUT", "/routes/d1", { target: "nope", mode: "read-only" });
    expect(bad.status).toBe(400);
    expect((await g.req("PUT", "/routes/d1", { target: `127.0.0.1:${t.port}`, mode: "write-all" })).status).toBe(400);
    const res = await g.req("PUT", "/routes/d1", { target: `127.0.0.1:${t.port}`, mode: "read-only", actuators: [HAZARD] });
    expect(res.status).toBe(200);
    const r = (await res.json()) as { address: string; port: number };
    cleanups.push(() => g.req("DELETE", "/routes/d1"));
    expect(r.address).toBe(`vehicle-gateway:${r.port}`);
    expect(await call(r.port, "GetServerInfo")).toMatchObject({ status: 0 });
    expect(await call(r.port, "Actuate", actuateByPath(HAZARD))).toMatchObject({ status: 7 });
    // Replaced in read-write: the same id, writes allowed now.
    const rw = (await (await g.req("PUT", "/routes/d1", { target: `127.0.0.1:${t.port}`, mode: "read-write", actuators: [HAZARD] })).json()) as { port: number };
    expect(await call(rw.port, "Actuate", actuateByPath(HAZARD))).toMatchObject({ status: 0 });
    const listed = (await (await g.req("GET", "/routes")).json()) as { routes: { id: string; mode: string }[] };
    expect(listed.routes).toEqual([expect.objectContaining({ id: "d1", mode: "read-write" })]);
    const audit = (await (await g.req("GET", "/routes/d1/audit")).json()) as { audit: { allowed: boolean; signal?: string }[] };
    expect(audit.audit).toEqual([expect.objectContaining({ allowed: true, signal: HAZARD })]);
    expect((await g.req("DELETE", "/routes/d1")).status).toBe(204);
    expect((await g.req("DELETE", "/routes/d1")).status).toBe(404);
    expect((await call(rw.port, "GetServerInfo")).status).not.toBe(0);
  });

  test("probe: the target's server and the paths it does not have; an unreachable target", async () => {
    const t = await fakeTarget();
    cleanups.push(t.close);
    const g = gateway(47110);
    const ok = (await (await g.req("POST", "/probe", { target: `127.0.0.1:${t.port}`, paths: [HAZARD, "Vehicle.Acme.Unknown"] })).json()) as Record<string, unknown>;
    expect(ok).toEqual({ reachable: true, api: "kuksa.val.v2", server: { name: "databroker", version: "0.5.0" }, missing: ["Vehicle.Acme.Unknown"] });
    const t2 = await fakeTarget();
    t2.close();
    const down = (await (await g.req("POST", "/probe", { target: `127.0.0.1:${t2.port}` })).json()) as Record<string, unknown>;
    expect(down).toMatchObject({ reachable: false, status: 14 });
  });
});
