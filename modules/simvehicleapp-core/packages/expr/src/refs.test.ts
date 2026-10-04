import { describe, expect, test } from "bun:test";
import { checkRefs, collectRefs, parseExpression, type RefResolver } from "./index.ts";

const parse = (s: string) => {
  const r = parseExpression(s);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
};

/** Fixture world: two blocks before the use, a few VSS signals, one variable, inside a loop. */
const resolver: RefResolver = {
  block: (name, field) => {
    const outputs: Record<string, Record<string, { valueType: string; unit?: string | null }>> = {
      whenspeedchanges1: { value: { valueType: "float", unit: "km/h" }, previous: { valueType: "float", unit: "km/h" }, timestamp: { valueType: "timestamp" } },
      readattribute1: { value: { valueType: "string" } },
    };
    const block = outputs[name];
    if (!block) return "unknown-block";
    return block[field.join(".")];
  },
  vehicle: (path) =>
    ({
      "Vehicle.Speed": { valueType: "float", unit: "km/h" },
      "Vehicle.OBD.PidsA": { valueType: "string[]" },
    })[path],
  variable: (name) => (name === "warnActive" ? { valueType: "boolean" } : undefined),
  container: (kind, field) => (kind === "loop" && field === "index" ? { valueType: "uint32" } : undefined),
};

describe("collectRefs (M03-T02)", () => {
  test("source order, including template parts, indexes and call args", () => {
    const ast = parse('"v={<Vehicle.Speed>}" + at(<Vehicle.OBD.PidsA>, <loop.index>) + <a.b>[<c.d>]');
    expect(collectRefs(ast).map((r) => r.path.join("."))).toEqual(["Vehicle.Speed", "Vehicle.OBD.PidsA", "loop.index", "a.b", "c.d"]);
  });

  test("duplicates are kept so every use can be flagged", () => {
    expect(collectRefs(parse("<a.b> + <a.b>"))).toHaveLength(2);
  });
});

describe("checkRefs", () => {
  test("resolves blocks, VSS signals, variables and loop fields", () => {
    const { refs, errors } = checkRefs(
      parse("<whenspeedchanges1.value> > <Vehicle.Speed> && <variable.warnActive> && <loop.index> < len(<Vehicle.OBD.PidsA>)"),
      resolver,
    );
    expect(errors).toEqual([]);
    expect(refs.map((r) => r.resolved)).toEqual([
      { valueType: "float", unit: "km/h" },
      { valueType: "float", unit: "km/h" },
      { valueType: "boolean" },
      { valueType: "uint32" },
      { valueType: "string[]" },
    ]);
  });

  test.each([
    ["<nope1.value>", "unknown_block"],
    ["<whenspeedchanges1.nope>", "unknown_field"],
    ["<Vehicle.Nope>", "unknown_signal"],
    ["<variable.missing>", "unknown_variable"],
    ["<loop.item>", "unknown_container_field"],
    ["<parallel.index>", "unknown_container_field"],
    ["<vehicle.speed>", "reserved_name"],
  ])("%s → EXPR_UNKNOWN_REF/%s with the reference span", (src, reason) => {
    const { errors } = checkRefs(parse(`1 + ${src}`), resolver);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "EXPR_UNKNOWN_REF", reason, ref: src, span: { start: 4, end: 4 + src.length } });
  });

  test("the reserved-name hint points to the VSS spelling", () => {
    expect(checkRefs(parse("<vehicle.speed>"), resolver).errors[0]!.message).toContain("<Vehicle.speed>");
  });

  test("each failing use is reported once, in source order", () => {
    const { errors } = checkRefs(parse("<x.a> + <Vehicle.Speed> + <x.a>"), resolver);
    expect(errors.map((e) => e.span.start)).toEqual([0, 26]);
  });
});
