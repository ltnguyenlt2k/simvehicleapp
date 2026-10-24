import { afterEach, describe, expect, test } from "bun:test";
import { actuateById, actuateByPath, call, fakeTarget, HAZARD, len } from "./test-helpers.ts";
import { Route, type RouteConfig } from "./route.ts";

const log = { info: () => {}, warn: () => {} };
const routes: Route[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const r of routes.splice(0)) await r.close();
  for (const c of cleanups.splice(0)) c();
});

async function route(target: number, over: Partial<RouteConfig> = {}) {
  const r = new Route({ id: "d1", target: `127.0.0.1:${target}`, tls: false, mode: "read-only", actuators: [HAZARD], ...over }, { log });
  routes.push(r);
  return { r, port: await r.start(0, "127.0.0.1") };
}

describe("vehicle-gateway route (M18-T09, ADR-0060)", () => {
  test("read-only: reads and streams pass, Actuate and provider methods are refused and audited", async () => {
    const t = await fakeTarget();
    cleanups.push(t.close);
    const { r, port } = await route(t.port, { token: "s3cret" });
    expect(await call(port, "GetServerInfo")).toMatchObject({ status: 0 });
    expect(await call(port, "Subscribe")).toMatchObject({ status: 0, messages: 2 });
    expect(await call(port, "Actuate", actuateByPath(HAZARD))).toMatchObject({ status: 7, message: "/kuksa.val.v2.VAL/Actuate: this deployment is read-only" });
    expect(await call(port, "PublishValue")).toMatchObject({ status: 7 });
    expect(await call(port, "OpenProviderStream")).toMatchObject({ status: 7 });
    // The token goes to the target; the app never sends one.
    expect(t.seen.map((s) => s.method)).toEqual(["/kuksa.val.v2.VAL/GetServerInfo", "/kuksa.val.v2.VAL/Subscribe"]);
    expect(t.seen.every((s) => s.authorization === "Bearer s3cret")).toBe(true);
    expect(r.audit.map((a) => [a.method.split("/").pop(), a.allowed])).toEqual([
      ["Actuate", false],
      ["PublishValue", false],
      ["OpenProviderStream", false],
    ]);
  });

  test("read-write: the app's actuators only, by path or by the id the target gives them", async () => {
    const t = await fakeTarget();
    cleanups.push(t.close);
    const { r, port } = await route(t.port, { mode: "read-write" });
    expect(await call(port, "Actuate", actuateByPath(HAZARD))).toMatchObject({ status: 0 });
    expect(await call(port, "Actuate", actuateById(65))).toMatchObject({ status: 0 });
    expect(await call(port, "Actuate", actuateByPath("Vehicle.Cabin.Door.Row1.DriverSide.IsLocked"))).toMatchObject({ status: 7, message: "Vehicle.Cabin.Door.Row1.DriverSide.IsLocked is not an actuator this app may set" });
    expect(await call(port, "Actuate", actuateById(12))).toMatchObject({ status: 7 });
    const batch = Uint8Array.from([...len(1, actuateByPath(HAZARD)), ...len(1, actuateByPath("Vehicle.Other"))]);
    expect(await call(port, "BatchActuate", batch)).toMatchObject({ status: 7 });
    expect(r.audit.filter((a) => a.allowed).map((a) => a.signal)).toEqual([HAZARD, "#65"]);
    expect(t.seen.filter((s) => s.method.endsWith("/Actuate"))).toHaveLength(2);
  });

  test("a target that does not answer: UNAVAILABLE, the route keeps running", async () => {
    const t = await fakeTarget();
    const dead = t.port;
    t.close();
    const { port } = await route(dead);
    expect((await call(port, "GetServerInfo")).status).toBe(14);
    expect((await call(port, "GetServerInfo")).status).toBe(14);
  });
});
