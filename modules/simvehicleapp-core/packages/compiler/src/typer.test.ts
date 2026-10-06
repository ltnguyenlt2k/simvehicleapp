import { describe, expect, test } from "bun:test";
import { parseExpression } from "@simvehicleapp/expr";
import type { ValueType } from "@simvehicleapp/types";
import { type RefBinding, Typer, type TyperCode } from "./typer.ts";

/** References of the test "workflow": block outputs, signals and a variable. */
const REFS: Record<string, RefBinding> = {
  "speedchanged.value": { expr: { $ref: "n1.value" }, type: "float", unit: "km/h" },
  "Vehicle.Speed": { expr: { $signal: "s0" }, type: "float", unit: "km/h" },
  "Vehicle.Powertrain.CombustionEngine.Speed": { expr: { $signal: "s1" }, type: "uint16", unit: "rpm" },
  "fan.value": { expr: { $ref: "n2.value" }, type: "uint8", unit: "percent" },
  "level.value": { expr: { $ref: "n3.value" }, type: "float", unit: "ratio" },
  "pids.value": { expr: { $signal: "s2" }, type: "string[]", unit: null },
  "temps.value": { expr: { $signal: "s3" }, type: "float[]", unit: "celsius" },
  "big.value": { expr: { $signal: "s4" }, type: "int64", unit: null },
  "name.value": { expr: { $ref: "n4.value" }, type: "string", unit: null },
  "variable.n": { expr: { $state: "v0" }, type: "int32", unit: null },
  "trig.timestamp": { expr: { $ref: "n1.timestamp" }, type: "timestamp", unit: null },
};

function typer() {
  return new Typer({ ref: (r) => REFS[r.path.join(".")] });
}

function typeOf(src: string) {
  const p = parseExpression(src);
  if (!p.ok) throw new Error(`${src}: ${p.error.message}`);
  const t = typer();
  return { t, out: t.type(p.ast), span: p.ast.span };
}

const codes = (t: Typer) => t.diagnostics.map((d) => d.code);

describe("typer: IR lowering with types and units (S4/S5)", () => {
  test("GW-A condition: a literal meeting km/h is read as km/h; int64 constants are decimal strings", () => {
    const { t, out } = typeOf("<speedchanged.value> > 120");
    expect(out?.expr).toEqual({
      $expr: { op: ">", l: { $ref: "n1.value" }, r: { $const: "120", type: "int64", unit: "km/h" }, type: "boolean" },
    });
    expect(codes(t)).toEqual(["UNIT_ASSUMED"]);
  });

  test("same quantity, other unit ⇒ unit.convert with the exact factor rounded once", () => {
    const { t, out } = typeOf("<Vehicle.Speed> > 30 m/s");
    expect(out?.expr).toEqual({
      $expr: {
        op: ">",
        l: { $signal: "s0" },
        r: {
          $expr: {
            op: "unit.convert",
            value: { $const: "30", type: "int64", unit: "m/s" },
            from: "m/s",
            to: "km/h",
            scale: { $const: 3.6, type: "double" },
            offset: { $const: 0, type: "double" },
            type: "double",
            unit: "km/h",
          },
        },
        type: "boolean",
      },
    });
    expect(codes(t)).toEqual(["UNIT_CONVERSION_INSERTED"]);
  });

  test("percent literal against a ratio signal converts (20 % = 0.2)", () => {
    const { t, out } = typeOf("<level.value> < 20 %");
    expect((out?.expr as { $expr: { r: { $expr: { scale: unknown } } } }).$expr.r.$expr.scale).toEqual({ $const: 0.01, type: "double" });
    expect(codes(t)).toEqual(["UNIT_CONVERSION_INSERTED"]);
  });

  const ERRORS: [string, TyperCode, Record<string, unknown>?][] = [
    ["<Vehicle.Speed> > <Vehicle.Powertrain.CombustionEngine.Speed>", "UNIT_DIMENSION_MISMATCH", { from: "rpm", to: "km/h" }],
    ["<Vehicle.Speed> > 3 fortnights", "UNIT_DIMENSION_MISMATCH", { reason: "unknown_unit", unit: "fortnights" }],
    ["<name.value> + 1", "TYPE_MISMATCH", { reason: "string_arithmetic" }],
    ["<name.value> + <name.value>", "TYPE_MISMATCH", { reason: "string_arithmetic" }],
    ["<name.value> > 1", "TYPE_MISMATCH", { reason: "not_comparable" }],
    ["<speedchanged.value> && true", "TYPE_MISMATCH", { reason: "not_boolean" }],
    ["!<speedchanged.value>", "TYPE_MISMATCH", { reason: "not_boolean" }],
    ["<big.value> * 2", "TYPE_MISMATCH", { reason: "integer_overflow" }],
    ["<big.value> > 1.5", "TYPE_MISMATCH", { reason: "int64_precision" }],
    ["99999999999999999999 + 1", "TYPE_MISMATCH", { reason: "integer_overflow" }],
    ["<speedchanged.value> > 1 ? \"fast\" : 0", "TYPE_MISMATCH", { reason: "branch_mismatch" }],
    ["<temps.value> > 30", "ARRAY_VALUE_REQUIRES_INDEXING"],
    ["<pids.value> == \"01\"", "ARRAY_VALUE_REQUIRES_INDEXING"],
    ["<temps.value>[0.5]", "ARRAY_INDEX_TYPE_INVALID", { type: "double" }],
    ["at(<temps.value>, 1.5)", "ARRAY_INDEX_TYPE_INVALID", { type: "double" }],
    ["contains(<pids.value>, 1)", "ARRAY_ELEMENT_TYPE_MISMATCH", { element: "string", value: "int64" }],
    ["len(<name.value>)", "TYPE_MISMATCH", { reason: "not_array" }],
    ["<trig.timestamp> + 1.5", "TYPE_MISMATCH", { reason: "time_arithmetic" }],
  ];
  for (const [src, code, data] of ERRORS) {
    test(`${src} ⇒ ${code}`, () => {
      const { t, out } = typeOf(src);
      expect(out).toBeUndefined();
      const errs = t.diagnostics.filter((d) => d.code !== "UNIT_ASSUMED" && d.code !== "UNIT_CONVERSION_INSERTED");
      expect(errs.map((d) => d.code)).toEqual([code]);
      if (data) expect(errs[0]!.data).toMatchObject(data);
    });
  }

  test("an unresolved reference types to nothing and reports nothing (S2 already did)", () => {
    const { t, out } = typeOf("<nosuch.value> + 1");
    expect(out).toBeUndefined();
    expect(t.diagnostics).toEqual([]);
  });

  test("result types: division is double, integer arithmetic carries ranges, arrays index to elements", () => {
    const cases: [string, ValueType, string | null][] = [
      ["<fan.value> / 2", "double", "percent"],
      ["<fan.value> + 1", "int64", "percent"],
      ["<fan.value> * <fan.value>", "int64", null],
      ["<variable.n> % 2", "double", null],
      ["len(<pids.value>)", "uint32", null],
      ["<temps.value>[0]", "float", "celsius"],
      ["at(<temps.value>, 0, 20)", "float", "celsius"],
      ["contains(<pids.value>, \"01\")", "boolean", null],
      ["round(<speedchanged.value>)", "double", "km/h"],
      ["max(<speedchanged.value>, 10)", "double", "km/h"],
      ["scale(<level.value>, 0, 1, 0, 100)", "double", null],
      ["now_ms() - <trig.timestamp>", "duration", null],
      ["\"Speed {<Vehicle.Speed>} km/h\"", "string", null],
      ["-273.15 celsius", "double", "celsius"],
      ["18446744073709551615", "uint64", null],
    ];
    for (const [src, type, unit] of cases) {
      const { out } = typeOf(src);
      expect([src, out?.info.type, out?.unit]).toEqual([src, type, unit]);
    }
  });

  test("GW-C ternary chain types to string", () => {
    const { t, out } = typeOf("<fan.value> < 10 ? \"OFF\" : <fan.value> < 40 ? \"INTERVAL\" : \"FAST\"");
    expect(out?.info.type).toBe("string");
    expect(codes(t)).toEqual(["UNIT_ASSUMED", "UNIT_ASSUMED"]);
  });

  test("templates lower to $template parts", () => {
    expect(typeOf("\"Speed {<Vehicle.Speed>} km/h\"").out?.expr).toEqual({ $template: ["Speed ", { $signal: "s0" }, " km/h"] });
  });
});

describe("typer: assignment to a typed target (ADR-0015 §3, Notes §6–§7)", () => {
  const assign = (src: string, target: { type: ValueType; unit: string | null }) => {
    const p = parseExpression(src);
    if (!p.ok) throw new Error(p.error.message);
    const t = typer();
    const v = t.type(p.ast);
    return { t, out: v && t.assign(v, target, p.ast.span) };
  };

  test("a literal takes the target type (codegen gets a uint8 constant)", () => {
    expect(assign("80", { type: "uint8", unit: "percent" }).out?.expr).toEqual({ $const: 80, type: "uint8", unit: "percent" });
    expect(assign("true", { type: "boolean", unit: null }).out?.expr).toEqual({ $const: true, type: "boolean" });
    expect(assign("\"RED\"", { type: "string", unit: null }).out?.expr).toEqual({ $const: "RED", type: "string" });
    expect(assign("0", { type: "uint8", unit: "percent" }).out?.expr).toEqual({ $const: 0, type: "uint8", unit: "percent" });
  });

  test("out-of-range literal, narrowing and mismatch", () => {
    expect(codes(assign("300", { type: "uint8", unit: null }).t)).toEqual(["VALUE_OUT_OF_RANGE"]);
    expect(codes(assign("<fan.value> + 1", { type: "uint8", unit: "percent" }).t)).toEqual(["UNIT_ASSUMED", "TYPE_NARROWING_REQUIRES_CAST"]);
    expect(codes(assign("<speedchanged.value> * 2", { type: "uint8", unit: null }).t)).toEqual(["TYPE_NARROWING_REQUIRES_CAST"]);
    expect(codes(assign("<name.value>", { type: "uint8", unit: null }).t)).toEqual(["TYPE_MISMATCH"]);
    expect(codes(assign("<temps.value>", { type: "float", unit: "celsius" }).t)).toEqual(["TYPE_MISMATCH"]);
  });

  test("allowed without Convert: widening, double → float, and a unit conversion to the target unit", () => {
    expect(assign("<fan.value>", { type: "int16", unit: "percent" }).t.diagnostics).toEqual([]);
    expect(assign("<speedchanged.value> * 0.5", { type: "float", unit: "km/h" }).t.diagnostics).toEqual([]);
    const conv = assign("<Vehicle.Speed>", { type: "double", unit: "m/s" });
    expect(codes(conv.t)).toEqual(["UNIT_CONVERSION_INSERTED"]);
    expect((conv.out?.expr as { $expr: { op: string } }).$expr.op).toBe("unit.convert");
    expect(codes(assign("<Vehicle.Speed>", { type: "double", unit: "rpm" }).t)).toEqual(["UNIT_DIMENSION_MISMATCH"]);
  });
});
