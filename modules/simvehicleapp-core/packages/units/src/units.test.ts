import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fixturesDir } from "@simvehicleapp/contracts";
import { canonicalUnit, type Conversion, conversion, convert, parseRational, rat, UNITS } from "./index.ts";

type UnitsYaml = Record<string, { quantity?: string; domain?: string }>;
/** v4.0 wraps the table in `units:`, v4.2 lists units at the top level. */
const yaml = (rel: string): UnitsYaml => {
  const doc = Bun.YAML.parse(readFileSync(`${fixturesDir}${rel}`, "utf8")) as { units?: UnitsYaml } & UnitsYaml;
  return (doc.units ?? doc) as UnitsYaml;
};
const V40 = yaml("vss/units.yaml");
const V42 = yaml("vss/v4.2/units.yaml");

const conv = (from: string, to: string) => {
  const c = conversion(from, to);
  if ("reason" in c) throw new Error(`${from} → ${to}: ${c.reason}`);
  return c as Conversion;
};

/** Units used by real signals of a release (`unit` of every node). */
function signalUnits(rel: string): Set<string> {
  const out = new Set<string>();
  const walk = (n: Record<string, { unit?: string; children?: Record<string, unknown> }>) => {
    for (const v of Object.values(n)) {
      if (v.unit) out.add(v.unit);
      if (v.children) walk(v.children as never);
    }
  };
  walk(JSON.parse(readFileSync(`${fixturesDir}${rel}`, "utf8")));
  return out;
}

describe("unit table covers VSS (ADR-0015 §6)", () => {
  test("every v4.2 unit is in the table with its VSS quantity", () => {
    for (const [u, def] of Object.entries(V42)) {
      expect(UNITS.get(u)?.quantity, u).toBe(def.quantity!);
    }
  });
  test("every v4.0 unit is in the table", () => {
    for (const u of Object.keys(V40)) expect(UNITS.has(u), u).toBe(true);
  });
  test("every unit used by a v4.0/v4.2 signal converts at least to itself", () => {
    for (const rel of ["vss/vss_rel_4.0.json", "vss/vss_rel_4.2.json"]) {
      for (const u of signalUnits(rel)) expect(conv(u, u).identity, `${rel} ${u}`).toBe(true);
    }
  });
  test("the table holds only VSS units (no invented keys)", () => {
    for (const u of UNITS.keys()) expect(u in V42 || u in V40, u).toBe(true);
  });
});

describe("conversions are exact", () => {
  test("100 km/h = 27.7778 m/s (250/9 exactly)", () => {
    const c = conv("km/h", "m/s");
    expect(c.exact.scale).toEqual(rat(5n, 18n));
    expect(convert(100, c)).toBeCloseTo(27.7778, 4);
    expect(convert(100, conv("m/s", "km/h"))).toBe(360);
  });
  const CASES: [string, string, number, number][] = [
    ["mm", "m", 1500, 1.5],
    ["km", "m", 2, 2000],
    ["inch", "mm", 1, 25.4],
    ["cm/s^2", "m/s^2", 981, 9.81],
    ["ml", "l", 250, 0.25],
    ["cm^3", "ml", 1, 1],
    ["kW", "W", 1.5, 1500],
    ["PS", "kW", 100, 73.549875],
    ["lbs", "kg", 1, 0.45359237],
    ["g", "kg", 500, 0.5],
    ["ms", "s", 2500, 2.5],
    ["min", "s", 2, 120],
    ["h", "min", 1.5, 90],
    ["day", "h", 1, 24],
    ["weeks", "day", 2, 14],
    ["mbar", "kPa", 1013, 101.3],
    ["psi", "kPa", 1, 6.894757293168361],
    ["kWh/100km", "Wh/km", 15, 150],
    ["ml/100km", "l/100km", 6500, 6.5],
    ["kN", "N", 1.2, 1200],
    ["cpm", "Hz", 60, 1],
    ["bpm", "cpm", 72, 72],
    ["percent", "ratio", 50, 0.5],
    ["ratio", "percent", 0.25, 25],
    ["nm/km", "ratio", 1e12, 1],
    ["%", "ratio", 20, 0.2],
    ["celsius", "celsius", 21.5, 21.5],
  ];
  for (const [from, to, v, want] of CASES) {
    test(`${v} ${from} = ${want} ${to}`, () => expect(convert(v, conv(from, to))).toBeCloseTo(want, 9));
  }
  test("round trips are exact in rationals for every convertible pair", () => {
    const keys = [...UNITS.keys()];
    let pairs = 0;
    for (const a of keys) {
      for (const b of keys) {
        const ab = conversion(a, b);
        if ("reason" in ab) continue;
        const ba = conv(b, a);
        // (x·s1 + o1)·s2 + o2 = x  ⇔  s1·s2 = 1 and o1·s2 + o2 = 0
        expect(ab.exact.scale.p * ba.exact.scale.p).toBe(ab.exact.scale.q * ba.exact.scale.q);
        const o = ab.exact.offset.p * ba.exact.scale.p * ba.exact.offset.q + ba.exact.offset.p * ab.exact.offset.q * ba.exact.scale.q;
        expect(o).toBe(0n);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(100);
  });
  test("the IR double is the exact rational rounded once", () => {
    const c = conv("km/h", "m/s");
    expect(c.scale).toBe(5 / 18);
    expect(c.offset).toBe(0);
  });
});

describe("what does not convert (UNIT_DIMENSION_MISMATCH)", () => {
  const NOT: [string, string][] = [
    ["km/h", "m"],
    ["percent", "dB"],
    ["dB", "dBm"],
    ["months", "day"],
    ["years", "months"],
    ["unix-time", "iso8601"],
    ["rpm", "degrees/s"],
    ["rpm", "Hz"],
    ["mpg", "l/100km"],
    ["kWh", "W"],
    ["Nm", "N"],
  ];
  for (const [a, b] of NOT) {
    test(`${a} ↛ ${b}`, () => expect(conversion(a, b)).toEqual({ reason: "dimension_mismatch", from: a, to: b }));
  }
  test("unknown units are reported", () => {
    expect(conversion("km/h", "mph")).toEqual({ reason: "unknown_unit", unit: "mph" });
    expect(conversion("fortnights", "s")).toEqual({ reason: "unknown_unit", unit: "fortnights" });
    expect(canonicalUnit("toString")).toBeUndefined();
    expect(canonicalUnit("%")).toBe("percent");
  });
});

describe("rationals", () => {
  test("parse decimals and fractions exactly", () => {
    expect(parseRational("0.0254")).toEqual(rat(127n, 5000n));
    expect(parseRational("1/3.6")).toEqual(rat(5n, 18n));
    expect(parseRational("-273.15")).toEqual(rat(-5463n, 20n));
    expect(() => parseRational("1e3")).toThrow();
    expect(() => rat(1n, 0n)).toThrow();
  });
});
