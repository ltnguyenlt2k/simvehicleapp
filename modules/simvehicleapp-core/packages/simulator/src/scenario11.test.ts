import { describe, expect, test } from "bun:test";
import { checkExpectations, isScenario11 } from "./scenario.ts";
import type { SimulationResult } from "./simulator.ts";

/** Scenario 1.1 expectations (ADR-0058 §9, design M18 §9.3): subset, `within`, `never`; 1.0 stays exact. */
const result = (writes: [number, string, unknown][], publishes: [number, string, string][] = []) =>
  ({ writes: writes.map(([t, path, value]) => ({ t, path, value })), publishes: publishes.map(([t, topic, payload]) => ({ t, topic, payload })), trace: [] }) as unknown as SimulationResult;
const H = "Vehicle.Body.Lights.Hazard.IsSignaling";
const L = "Vehicle.ADAS.LaneDepartureDetection.IsEnabled";

describe("scenario 1.1", () => {
  test("version: 1.1 and later minor versions only", () => {
    expect(isScenario11("1.1.0")).toBe(true);
    expect(isScenario11("1.2.3")).toBe(true);
    expect(isScenario11("1.0.0")).toBe(false);
    expect(isScenario11(undefined)).toBe(false);
  });

  test("a subset: extra writes do not fail; within accepts a late write, not an early one", () => {
    const r = result([[0, L, false], [2010, H, true], [2500, H, false]]);
    expect(checkExpectations(r, { writes: [{ t: 2000, path: H, value: true, within: 50 }] }, "1.1.0")).toEqual([]);
    expect(checkExpectations(r, { writes: [{ t: 2000, path: H, value: true }] }, "1.1.0")[0]?.kind).toBe("writes");
    expect(checkExpectations(r, { writes: [{ t: 2020, path: H, value: true, within: 100 }] }, "1.1.0")).toHaveLength(1);
    // the same expectation in 1.0 is an exact list: the extra writes fail it
    expect(checkExpectations(r, { writes: [{ t: 2010, path: H, value: true }] }, "1.0.0")).toHaveLength(1);
  });

  test("in order, each actual write used once", () => {
    const r = result([[100, H, true], [200, H, false]]);
    expect(checkExpectations(r, { writes: [{ t: 100, path: H, value: true }, { t: 200, path: H, value: false }] }, "1.1.0")).toEqual([]);
    expect(checkExpectations(r, { writes: [{ t: 200, path: H, value: false }, { t: 100, path: H, value: true }] }, "1.1.0")).toHaveLength(1);
    expect(checkExpectations(r, { writes: [{ t: 100, path: H, value: true }, { t: 100, path: H, value: true }] }, "1.1.0")).toHaveLength(1);
  });

  test("never: no write of the path in the window", () => {
    const r = result([[500, L, true]]);
    expect(checkExpectations(r, { never: [{ path: H }] }, "1.1.0")).toEqual([]);
    const m = checkExpectations(r, { never: [{ path: L, from: 0, to: 1000 }] }, "1.1.0");
    expect(m).toEqual([{ kind: "never", message: `${L} must not be written in [0, 1000] ms: written true at 500 ms` }]);
    expect(checkExpectations(r, { never: [{ path: L, from: 600 }] }, "1.1.0")).toEqual([]);
  });

  test("publishes match topic and payload within the window", () => {
    const r = result([], [[1205, "app/hmi", '{"title":"Overspeed"}']]);
    expect(checkExpectations(r, { publishes: [{ t: 1200, topic: "app/hmi", payload: '{"title":"Overspeed"}', within: 10 }] }, "1.1.0")).toEqual([]);
    expect(checkExpectations(r, { publishes: [{ t: 1200, topic: "app/hmi", payload: "x", within: 10 }] }, "1.1.0")[0]?.kind).toBe("publishes");
  });
});
