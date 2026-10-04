import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildSearchIndex, parseVssRelease, tokenize } from "./index.ts";

const load = (r: string) =>
  parseVssRelease(JSON.parse(readFileSync(fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/fixtures/vss/vss_rel_${r}.json`)), "utf8")), `v${r}`);

const models = { "v4.0": load("4.0"), "v4.2": load("4.2") };
const paths = (hits: { node: { path: string } }[]) => hits.map((h) => h.node.path);

test("tokenize splits camelCase, acronyms, digits and separators", () => {
  expect(tokenize("Vehicle.Powertrain.TractionBattery.StateOfCharge.Current")).toEqual([
    "vehicle",
    "powertrain",
    "traction",
    "battery",
    "state",
    "of",
    "charge",
    "current",
  ]);
  expect(tokenize("ADAS.ABS.IsEnabled Row1 OBD-PidsA")).toEqual(["adas", "abs", "is", "enabled", "row", "1", "obd", "pids", "a"]);
});

describe.each(Object.entries(models))("%s", (_release, model) => {
  const index = buildSearchIndex(model);

  test("top-5 for 'state of charge' contains …StateOfCharge.Current (M02-T03)", () => {
    expect(paths(index.search("state of charge", { limit: 5 }))).toContain("Vehicle.Powertrain.TractionBattery.StateOfCharge.Current");
  });

  test("kind filter", () => {
    const sensors = index.search("state of charge", { kind: "sensor" });
    expect(sensors.length).toBeGreaterThan(0);
    expect(sensors.every((h) => h.node.kind === "sensor")).toBe(true);
    expect(paths(sensors)[0]).toBe("Vehicle.Powertrain.TractionBattery.StateOfCharge.Current");
    expect(index.search("speed", { kind: "attribute" }).every((h) => h.node.kind === "attribute")).toBe(true);
  });

  test("exact path ranks first; shallow name match beats deep ones", () => {
    expect(paths(index.search("Vehicle.Speed"))[0]).toBe("Vehicle.Speed");
    expect(paths(index.search("speed"))[0]).toBe("Vehicle.Speed");
    expect(paths(index.search("VIN"))).toEqual(["Vehicle.VehicleIdentification.VIN"]);
  });

  test("multi-word queries need every non-stopword token", () => {
    const hits = index.search("wiping mode", { kind: "actuator", limit: 2 });
    expect(paths(hits)).toEqual(["Vehicle.Body.Windshield.Front.Wiping.Mode", "Vehicle.Body.Windshield.Rear.Wiping.Mode"]);
    expect(index.search("hazard zzzz")).toEqual([]);
  });

  test("fuzzy: one typo still finds the signal", () => {
    expect(paths(index.search("spead", { limit: 10 }))).toContain("Vehicle.Speed");
    expect(paths(index.search("hazzard", { limit: 3 }))).toContain("Vehicle.Body.Lights.Hazard.IsSignaling");
  });

  test("description is searched", () => {
    const hits = index.search("odometer");
    expect(hits.length).toBeGreaterThan(0);
    expect(paths(hits)).toContain("Vehicle.TraveledDistance");
  });

  test("empty, stopword-only and punctuation queries return nothing; root is never returned", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("of the")).toEqual([]);
    expect(index.search("..")).toEqual([]);
    expect(paths(index.search("vehicle", { limit: 500 }))).not.toContain("Vehicle");
  });

  test("limit is clamped to 1..500 and results are deterministic", () => {
    expect(index.search("speed", { limit: 0 })).toHaveLength(1);
    expect(index.search("vehicle", { limit: 10_000 }).length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(buildSearchIndex(model).search("door", { limit: 100 }))).toBe(JSON.stringify(index.search("door", { limit: 100 })));
  });
});
