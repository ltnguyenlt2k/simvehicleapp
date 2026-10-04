import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadSchema, SCHEMA_NAMES } from "@simvehicleapp/contracts";
import { blocksFor, canonicalJson, parseVssRelease, VssParseError, type VssModel, type VssNode } from "./index.ts";

const contractFile = (rel: string) => fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/${rel}`));
const loadJson = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(contractFile(rel), "utf8"));

const doc40 = loadJson("fixtures/vss/vss_rel_4.0.json");
const doc42 = loadJson("fixtures/vss/vss_rel_4.2.json");
const v40 = parseVssRelease(doc40, "v4.0");
const v42 = parseVssRelease(doc42, "v4.2");

const node = (m: VssModel, path: string): VssNode => {
  const n = m.nodes.get(path);
  if (!n) throw new Error(`missing ${path}`);
  return n;
};

/** Known VSS 4.0 facts (vss-signals skill, ADR-0010 Verification), checked against the fixture on 2026-10-04. */
const KNOWN_40: [path: string, kind: VssNode["kind"], datatype: string | undefined, unit: string | undefined][] = [
  ["Vehicle.Speed", "sensor", "float", "km/h"],
  ["Vehicle.IsMoving", "sensor", "boolean", undefined],
  ["Vehicle.TraveledDistance", "sensor", "float", "km"],
  ["Vehicle.Powertrain.TractionBattery.StateOfCharge.Current", "sensor", "float", "percent"],
  ["Vehicle.Powertrain.CombustionEngine.Speed", "sensor", "uint16", "rpm"],
  ["Vehicle.Body.Raindetection.Intensity", "sensor", "uint8", "percent"],
  ["Vehicle.Exterior.AirTemperature", "sensor", "float", "celsius"],
  ["Vehicle.Chassis.Axle.Row1.Wheel.Left.Tire.Pressure", "sensor", "uint16", "kPa"],
  ["Vehicle.CurrentLocation.Latitude", "sensor", "double", "degrees"],
  ["Vehicle.Body.Lights.Hazard.IsSignaling", "actuator", "boolean", undefined],
  ["Vehicle.Body.Lights.Beam.Low.IsOn", "actuator", "boolean", undefined],
  ["Vehicle.Body.Windshield.Front.Wiping.Mode", "actuator", "string", undefined],
  ["Vehicle.Cabin.Door.Row1.DriverSide.IsLocked", "actuator", "boolean", undefined],
  ["Vehicle.Cabin.Door.Row1.DriverSide.Window.Position", "actuator", "uint8", "percent"],
  ["Vehicle.Cabin.Seat.Row1.DriverSide.Position", "actuator", "uint16", "mm"],
  ["Vehicle.Cabin.Light.InteractiveLightBar.Color", "actuator", "string", undefined],
  ["Vehicle.Cabin.HVAC.Station.Row1.Driver.FanSpeed", "actuator", "uint8", "percent"],
  ["Vehicle.ADAS.CruiseControl.SpeedSet", "actuator", "float", "km/h"],
  ["Vehicle.Powertrain.TractionBattery.Charging.ChargeLimit", "actuator", "uint8", "percent"],
  ["Vehicle.VehicleIdentification.VIN", "attribute", "string", undefined],
  ["Vehicle.Cabin.DoorCount", "attribute", "uint8", undefined],
  ["Vehicle.OBD.PidsA", "attribute", "string[]", undefined],
  ["Vehicle.Cabin.SeatPosCount", "attribute", "uint8[]", undefined],
  ["Vehicle.Cabin", "branch", undefined, undefined],
];

describe("VSS 4.0 fixture", () => {
  test("node counts by kind (ADR-0010 Context)", () => {
    expect(v40.counts).toEqual({ branch: 287, actuator: 425, sensor: 379, attribute: 106 });
    expect(v40.nodes.size).toBe(1197);
    expect(v40.roots).toEqual(["Vehicle"]);
  });

  test.each(KNOWN_40)("%s is %s/%s/%s", (path, kind, datatype, unit) => {
    const n = node(v40, path);
    expect(n.kind).toBe(kind);
    expect(n.datatype).toBe(datatype as VssNode["datatype"]);
    expect(n.unit).toBe(unit);
    expect(n.name).toBe(path.split(".").pop()!);
  });

  test("allowed, default, min/max survive normalization", () => {
    expect(node(v40, "Vehicle.Body.Windshield.Front.Wiping.Mode").allowed).toContain("RAIN_SENSOR");
    expect(node(v40, "Vehicle.Cabin.DoorCount").default).toBe(4);
    expect(node(v40, "Vehicle.Cabin.SeatPosCount").default).toEqual([2, 3]);
    expect(node(v40, "Vehicle.OBD.PidsA").allowed).toHaveLength(32);
    const soc = node(v40, "Vehicle.Powertrain.TractionBattery.StateOfCharge.Current");
    expect([soc.min, soc.max]).toEqual([0, 100]);
  });

  test("children keep release order and cover every non-root node exactly once", () => {
    expect(v40.children.get("Vehicle.Cabin.Door.Row1")).toEqual(["Vehicle.Cabin.Door.Row1.DriverSide", "Vehicle.Cabin.Door.Row1.PassengerSide"]);
    const listed = [...v40.children.values()].flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.length).toBe(v40.nodes.size - v40.roots.length);
  });

  test("no 4.0 entry is deprecated and no actuator is array-typed (ADR-0018 Context §3)", () => {
    const all = [...v40.nodes.values()];
    expect(all.filter((n) => n.deprecation !== undefined)).toHaveLength(0);
    expect(all.filter((n) => n.kind === "actuator" && n.datatype?.endsWith("[]"))).toHaveLength(0);
  });
});

describe("VSS 4.2 fixture", () => {
  test("node counts and deprecation entries (ADR-0010 Notes 2026-10-04)", () => {
    expect(v42.counts).toEqual({ branch: 322, actuator: 484, sensor: 467, attribute: 118 });
    expect([...v42.nodes.values()].filter((n) => n.deprecation !== undefined)).toHaveLength(165);
  });

  test("deprecation is the free-text string from the release", () => {
    expect(node(v42, "Vehicle.Body.RefuelPosition").deprecation).toBe(
      "v4.1 replaced with Vehicle.Powertrain.TractionBattery.Charging.ChargePortPosition and Vehicle.Powertrain.FuelSystem.RefuelPortPosition",
    );
  });
});

describe("contract conformance", () => {
  const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
  for (const name of SCHEMA_NAMES) ajv.addSchema(loadSchema(name));
  const openapi = Bun.YAML.parse(readFileSync(contractFile("openapi/vss-catalog.v1.yaml"), "utf8")) as {
    components: { schemas: Record<string, unknown> };
  };
  const { VssNode: schema, ...siblings } = openapi.components.schemas;
  // `#/components/schemas/NodeKind` is a document-local ref; inline the sibling schemas it may point to.
  const validate = ajv.compile(
    JSON.parse(JSON.stringify(schema).replaceAll('"#/components/schemas/', '"#/$defs/').replace(/^\{/, `{"$defs":${JSON.stringify(siblings)},`)),
  );

  test.each([
    ["v4.0", v40],
    ["v4.2", v42],
  ] as const)("every non-root %s node is a valid VssNode", (_r, model) => {
    const invalid = [...model.nodes.values()].filter((n) => !model.roots.includes(n.path) && !(validate(n) as boolean));
    expect(invalid.map((n) => n.path)).toEqual([]);
  });
});

describe("model hash", () => {
  test("is independent of key order", () => {
    const shuffled = (v: unknown): unknown =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, shuffled(x)]),
          )
        : v;
    expect(parseVssRelease(shuffled(doc40), "v4.0").modelHash).toBe(v40.modelHash);
  });

  test("is pinned for the seeded releases (canonicalization must not drift)", () => {
    expect(v40.modelHash).toMatch(/^[0-9a-f]{64}$/);
    expect(v40.modelHash).not.toBe(v42.modelHash);
    expect({ v40: v40.modelHash, v42: v42.modelHash }).toMatchSnapshot();
  });

  test("canonicalJson sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: "x" }, u: undefined })).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
  });
});

describe("block availability (ADR-0010 §6)", () => {
  test("by kind", () => {
    expect(blocksFor(node(v40, "Vehicle.Speed"))).toEqual(["sv_read_signal", "sv_on_signal_changed"]);
    expect(blocksFor(node(v40, "Vehicle.Body.Lights.Hazard.IsSignaling"))).toEqual(["sv_read_signal", "sv_on_signal_changed", "sv_set_actuator"]);
    expect(blocksFor(node(v40, "Vehicle.VehicleIdentification.VIN"))).toEqual(["sv_read_attribute"]);
    expect(blocksFor(node(v40, "Vehicle.Cabin"))).toEqual([]);
  });

  test("sensors never offer Set; array actuators are read-only (ADR-0018 §2)", () => {
    for (const n of v40.nodes.values()) if (n.kind === "sensor") expect(blocksFor(n)).not.toContain("sv_set_actuator");
    expect(blocksFor({ kind: "actuator", datatype: "string[]" })).toEqual(["sv_read_signal", "sv_on_signal_changed"]);
  });
});

describe("validation and value encoding", () => {
  const doc = (leaf: Record<string, unknown>) => ({ Vehicle: { type: "branch", children: { X: leaf } } });
  const parseLeaf = (leaf: Record<string, unknown>) => node(parseVssRelease(doc(leaf), "v9.9"), "Vehicle.X");

  test("int64/uint64 become decimal strings without precision loss (ADR-0018 §7)", () => {
    expect(parseLeaf({ type: "attribute", datatype: "int64", default: "9223372036854775000" }).default).toBe("9223372036854775000");
    expect(parseLeaf({ type: "attribute", datatype: "uint64", default: 42 }).default).toBe("42");
    expect(parseLeaf({ type: "sensor", datatype: "uint64[]", allowed: ["18446744073709551615", 0] }).allowed).toEqual(["18446744073709551615", "0"]);
  });

  test.each([
    [{ type: "sensor", datatype: "int64", default: 9223372036854775000 }, "exactly representable int64"],
    [{ type: "sensor", datatype: "uint64", default: "18446744073709551616" }, "out of range"],
    [{ type: "sensor", datatype: "uint8", default: 256 }, "out of range"],
    [{ type: "sensor", datatype: "int8", default: 1.5 }, "exactly representable int8"],
    [{ type: "sensor", datatype: "uint32", default: "7" }, "exactly representable uint32"],
    [{ type: "sensor", datatype: "boolean", default: "true" }, "expected a boolean"],
    [{ type: "sensor", datatype: "string[]", default: "a" }, "expected an array"],
    [{ type: "sensor", datatype: "struct" }, "unknown datatype"],
    [{ type: "property", datatype: "string" }, "unknown node type"],
    [{ type: "sensor", datatype: "float", min: "0" }, "'min' must be a finite number"],
    [{ type: "sensor", datatype: "string", allowed: [] }, "'allowed' must be a non-empty array"],
    [{ type: "sensor", datatype: "string", deprecation: true }, "'deprecation' must be a string"],
    [{ type: "sensor", datatype: "float", children: {} }, "must not have children"],
  ])("rejects %j", (leaf, message) => {
    expect(() => parseLeaf(leaf)).toThrow(message);
  });

  test("errors carry the node path", () => {
    try {
      parseLeaf({ type: "sensor", datatype: "uint8", default: 300 });
      throw new Error("unreachable");
    } catch (e) {
      expect(e).toBeInstanceOf(VssParseError);
      expect((e as VssParseError).path).toBe("Vehicle.X.default");
    }
  });

  test("rejects malformed documents and releases", () => {
    expect(() => parseVssRelease(doc40, "4.0")).toThrow("release '4.0'");
    expect(() => parseVssRelease([], "v4.0")).toThrow("non-empty object");
    expect(() => parseVssRelease({ Vehicle: { type: "sensor", datatype: "float" } }, "v4.0")).toThrow("root must be a branch");
    expect(() => parseVssRelease({ Vehicle: { type: "branch", children: { "a-b": { type: "branch" } } } }, "v4.0")).toThrow("invalid child name");
  });

  test("parsing twice gives identical output (determinism)", () => {
    const again = parseVssRelease(doc40, "v4.0");
    expect(JSON.stringify([...again.nodes.values()])).toBe(JSON.stringify([...v40.nodes.values()]));
  });
});
