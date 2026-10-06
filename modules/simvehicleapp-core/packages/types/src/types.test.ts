import { describe, expect, test } from "bun:test";
import {
  type ArithmeticOp,
  arithmetic,
  assignable,
  callType,
  type ComparisonOp,
  compare,
  indexType,
  integerBounds,
  isValueType,
  literalType,
  logical,
  negate,
  type TypeInfo,
  typeOf,
  unify,
  type ValueType,
} from "./index.ts";

const T = (t: ValueType) => typeOf(t);
const L = (raw: string) => literalType(raw);
const name = (t: TypeInfo) =>
  t.literal && t.range ? `lit ${t.range.min}` : t.literal ? "lit double" : t.type
const show = (r: ReturnType<typeof arithmetic>) =>
  r.ok ? `${r.info.type}${r.info.range ? `[${r.info.range.min},${r.info.range.max}]` : ""}` : `!${r.reason}`;

/** [op, left, right, expected] — ADR-0015 Notes §7. */
const ARITHMETIC: [ArithmeticOp, TypeInfo, TypeInfo, string][] = [
  ["+", T("uint8"), T("uint8"), "int64[0,510]"],
  ["+", T("int8"), T("uint8"), "int64[-128,382]"],
  ["-", T("uint8"), T("uint8"), "int64[-255,255]"],
  ["*", T("int8"), T("int8"), "int64[-16256,16384]"],
  ["*", T("int32"), T("int32"), "int64[-4611686016279904256,4611686018427387904]"],
  ["+", T("int32"), T("uint32"), "int64[-2147483648,6442450942]"],
  ["+", T("int64"), T("int64"), "!integer_overflow"],
  ["*", T("int64"), L("2"), "!integer_overflow"],
  ["+", T("uint64"), L("1"), "!integer_overflow"],
  ["-", T("uint64"), L("0"), "!integer_overflow"],
  ["+", T("int64"), L("0"), "int64[-9223372036854775808,9223372036854775807]"],
  ["+", L("1"), L("2"), "int64[3,3]"],
  ["-", L("5"), L("7"), "int64[-2,-2]"],
  ["*", L("-3"), L("4"), "int64[-12,-12]"],
  ["+", T("uint8"), L("1"), "int64[1,256]"],
  ["+", T("float"), T("float"), "double"],
  ["+", T("float"), T("int32"), "double"],
  ["*", T("double"), L("2"), "double"],
  ["+", T("float"), T("int64"), "!int64_precision"],
  ["+", T("double"), T("uint64"), "!int64_precision"],
  ["+", T("double"), L("9007199254740993"), "!int64_precision"],
  ["+", T("double"), L("9007199254740992"), "double"],
  ["/", L("7"), L("2"), "double"],
  ["/", T("uint8"), T("uint8"), "double"],
  ["/", T("int64"), L("2"), "!int64_precision"],
  ["%", L("7"), L("2"), "double"],
  ["%", T("int32"), T("int32"), "double"],
  ["%", T("float"), L("2"), "double"],
  ["+", T("string"), T("string"), "!string_arithmetic"],
  ["+", T("string"), L("1"), "!string_arithmetic"],
  ["*", T("boolean"), L("1"), "!not_numeric"],
  ["+", T("boolean"), T("boolean"), "!not_numeric"],
  ["+", T("float[]"), L("1"), "!array_requires_indexing"],
  ["+", T("uint8[]"), T("uint8[]"), "!array_requires_indexing"],
  ["+", T("json"), L("1"), "!not_numeric"],
  ["-", T("timestamp"), T("timestamp"), "duration[-9223372036854775808,9223372036854775807]"],
  ["+", T("timestamp"), T("duration"), "timestamp[-9223372036854775808,9223372036854775807]"],
  ["+", T("duration"), T("timestamp"), "timestamp[-9223372036854775808,9223372036854775807]"],
  ["-", T("timestamp"), T("duration"), "timestamp[-9223372036854775808,9223372036854775807]"],
  ["+", T("duration"), T("duration"), "duration[-9223372036854775808,9223372036854775807]"],
  ["*", T("duration"), L("3"), "duration[-9223372036854775808,9223372036854775807]"],
  ["*", L("3"), T("duration"), "duration[-9223372036854775808,9223372036854775807]"],
  ["*", T("duration"), T("double"), "!time_arithmetic"],
  ["+", T("timestamp"), T("timestamp"), "!time_arithmetic"],
  ["-", T("duration"), T("timestamp"), "!time_arithmetic"],
  ["/", T("duration"), L("2"), "!time_arithmetic"],
  ["*", T("timestamp"), L("2"), "!time_arithmetic"],
  ["+", T("timestamp"), L("1000"), "!time_arithmetic"],
];

/** [op, left, right, ok | reason] */
const COMPARISON: [ComparisonOp, TypeInfo, TypeInfo, string][] = [
  [">", T("float"), L("120"), "ok"],
  [">", T("float"), L("120.5"), "ok"],
  ["<", T("uint8"), T("int8"), "ok"],
  ["==", T("int64"), T("int64"), "ok"],
  ["==", T("uint64"), L("1"), "ok"],
  ["<", T("int64"), T("double"), "!int64_precision"],
  [">=", T("uint64"), T("float"), "!int64_precision"],
  ["==", T("string"), T("string"), "ok"],
  ["!=", T("boolean"), T("boolean"), "ok"],
  ["<", T("string"), T("string"), "!not_comparable"],
  ["==", T("string"), L("1"), "!not_comparable"],
  ["==", T("boolean"), L("1"), "!not_comparable"],
  ["==", T("float[]"), T("float[]"), "!array_requires_indexing"],
  [">", T("duration"), L("2000"), "ok"],
  [">", T("timestamp"), T("timestamp"), "ok"],
  ["<", T("timestamp"), T("double"), "!not_comparable"],
  ["==", T("json"), T("json"), "!not_comparable"],
  ["<=", T("double"), T("float"), "ok"],
];

/** [from, to, ok | reason] — ADR-0015 §3 + Notes §6–§7. */
const ASSIGN: [TypeInfo, ValueType, string][] = [
  [L("80"), "uint8", "ok"],
  [L("255"), "uint8", "ok"],
  [L("256"), "uint8", "!out_of_range"],
  [L("-1"), "uint8", "!out_of_range"],
  [L("0"), "uint8", "ok"],
  [L("-128"), "int8", "ok"],
  [L("9223372036854775807"), "int64", "ok"],
  [L("9223372036854775808"), "int64", "!out_of_range"],
  [L("18446744073709551615"), "uint64", "ok"],
  [T("uint8"), "uint8", "ok"],
  [T("uint8"), "int16", "ok"],
  [T("int8"), "uint8", "!narrowing"],
  [T("int32"), "uint8", "!narrowing"],
  [T("uint32"), "int64", "ok"],
  [T("uint64"), "int64", "!narrowing"],
  [arithmetic("+", T("uint8"), L("1")).ok ? (arithmetic("+", T("uint8"), L("1")) as { info: TypeInfo }).info : T("int64"), "uint8", "!narrowing"],
  [arithmetic("+", T("uint8"), L("1")).ok ? (arithmetic("+", T("uint8"), L("1")) as { info: TypeInfo }).info : T("int64"), "uint16", "ok"],
  [T("double"), "uint8", "!narrowing"],
  [T("float"), "int32", "!narrowing"],
  [L("0.5"), "uint8", "!narrowing"],
  [T("double"), "float", "ok:float32"],
  [T("int32"), "float", "ok:float32"],
  [T("float"), "float", "ok"],
  [T("float"), "double", "ok"],
  [T("int32"), "double", "ok"],
  [T("int64"), "double", "!narrowing"],
  [T("uint64"), "float", "!narrowing"],
  [T("boolean"), "boolean", "ok"],
  [T("string"), "string", "ok"],
  [T("string"), "uint8", "!mismatch"],
  [T("boolean"), "string", "!mismatch"],
  [L("1"), "boolean", "!mismatch"],
  [T("float[]"), "float", "!mismatch"],
  [T("float"), "float[]", "!array_not_writable"],
  [T("float[]"), "float[]", "ok"],
  [T("uint8"), "json", "ok"],
  [T("string[]"), "json", "ok"],
  [T("duration"), "int64", "ok"],
  [T("duration"), "uint32", "!narrowing"],
  [L("2000"), "duration", "ok"],
  [T("timestamp"), "int64", "ok"],
];

const CALLS: [string, TypeInfo[], string][] = [
  ["abs", [T("int8")], "int64[0,128]"],
  ["abs", [L("-5")], "int64[5,5]"],
  ["abs", [T("uint8")], "int64[0,255]"],
  ["abs", [T("float")], "double"],
  ["abs", [T("int64")], "!integer_overflow"],
  ["abs", [T("string")], "!not_numeric"],
  ["min", [T("uint8"), T("int8")], "int64[-128,127]"],
  ["max", [T("float"), L("3")], "double"],
  ["clamp", [T("int32"), L("0"), L("100")], "int64[0,100]"],
  ["clamp", [T("uint32"), L("0"), L("100")], "int64[0,100]"],
  ["min", [T("uint32"), L("255")], "int64[0,255]"],
  ["max", [T("int8"), L("0")], "int64[0,127]"],
  ["min", [L("3"), L("7"), L("5")], "int64[3,3]"],
  ["min", [T("string"), T("string")], "!not_numeric"],
  ["round", [T("double")], "double"],
  ["round", [T("float"), L("2")], "double"],
  ["floor", [T("uint8")], "double"],
  ["ceil", [T("int64")], "!int64_precision"],
  ["scale", [T("float"), L("0"), L("100"), L("0"), L("1")], "double"],
  ["in_range", [T("float"), L("0"), L("100")], "boolean"],
  ["now_ms", [], "timestamp[-9223372036854775808,9223372036854775807]"],
  ["len", [T("string[]")], "uint32[0,4294967295]"],
  ["len", [T("string")], "!not_array"],
  ["contains", [T("string[]"), T("string")], "boolean"],
  ["contains", [T("uint8"), L("1")], "!not_array"],
  ["at", [T("float[]"), L("0")], "float"],
  ["at", [T("uint8[]"), L("0"), L("0")], "uint8[0,255]"],
  ["at", [T("uint8[]"), T("double")], "!not_numeric"],
  ["at", [T("uint8"), L("0")], "!not_array"],
];

describe("types: arithmetic (ADR-0015 Notes §7)", () => {
  for (const [op, a, b, want] of ARITHMETIC) {
    test(`${name(a)} ${op} ${name(b)} ⇒ ${want}`, () => expect(show(arithmetic(op, a, b))).toBe(want));
  }
});

describe("types: comparison", () => {
  for (const [op, a, b, want] of COMPARISON) {
    test(`${name(a)} ${op} ${name(b)} ⇒ ${want}`, () => {
      const r = compare(op, a, b);
      expect(r.ok ? (r.info.type === "boolean" ? "ok" : "?") : `!${r.reason}`).toBe(want);
    });
  }
});

describe("types: assignment without Convert", () => {
  for (const [from, to, want] of ASSIGN) {
    test(`${name(from)}${from.range && !from.literal ? `[${from.range.min},${from.range.max}]` : ""} → ${to} ⇒ ${want}`, () => {
      const r = assignable(from, to);
      expect(r.ok ? (r.rounding ? `ok:${r.rounding}` : "ok") : `!${r.reason}`).toBe(want);
    });
  }
});

describe("types: functions", () => {
  for (const [fn, args, want] of CALLS) {
    test(`${fn}(${args.map(name).join(", ")}) ⇒ ${want}`, () => expect(show(callType(fn, args))).toBe(want));
  }
  test("a non-whitelisted function is a programming error (the parser rejects it first)", () => {
    expect(() => callType("eval", [])).toThrow();
  });
});

describe("types: other rules", () => {
  test("logical operators need booleans", () => {
    expect(logical(T("boolean"), T("boolean")).ok).toBe(true);
    expect(logical(T("boolean")).ok).toBe(true);
    expect(logical(T("boolean"), L("1"))).toEqual({ ok: false, reason: "not_boolean" });
    expect(logical(T("string"))).toEqual({ ok: false, reason: "not_boolean" });
  });
  test("negation keeps the literal flag and reflects ranges", () => {
    expect(negate(L("80"))).toEqual({ ok: true, info: { type: "int64", range: { min: -80n, max: -80n }, literal: true } });
    expect(show(negate(T("uint8")))).toBe("int64[-255,0]");
    expect(show(negate(T("int64")))).toBe("!integer_overflow");
    expect(show(negate(T("float")))).toBe("double");
    expect(show(negate(T("string")))).toBe("!not_numeric");
    expect(show(negate(T("timestamp")))).toBe("!not_numeric");
  });
  test("ternary branches unify", () => {
    expect(show(unify(L("1"), L("5")))).toBe("int64[1,5]");
    expect(show(unify(T("uint8"), T("float")))).toBe("double");
    expect(show(unify(T("string"), T("string")))).toBe("string");
    expect(show(unify(T("string"), L("1")))).toBe("!branch_mismatch");
    expect(show(unify(T("boolean"), T("boolean")))).toBe("boolean");
    expect(show(unify(T("duration"), T("timestamp")))).toBe("!branch_mismatch");
    expect(show(unify(T("float[]"), T("float[]")))).toBe("!array_requires_indexing");
  });
  test("index needs an array and an integer index", () => {
    expect(show(indexType(T("int16[]"), L("2")))).toBe("int16[-32768,32767]");
    expect(show(indexType(T("int16"), L("2")))).toBe("!not_array");
    expect(show(indexType(T("int16[]"), T("float")))).toBe("!not_numeric");
  });
  test("literal types are exact (int64-safe) and decimals are double", () => {
    expect(literalType("9223372036854775807").range).toEqual({ min: 9223372036854775807n, max: 9223372036854775807n });
    expect(literalType("0.5").type).toBe("double");
    expect(literalType("1e3").type).toBe("double");
  });
  test("integer bounds and the value-type list match the contracts", () => {
    expect(integerBounds("uint64").max).toBe(18446744073709551615n);
    expect(integerBounds("int8").min).toBe(-128n);
    for (const t of ["boolean", "int64[]", "string[]", "duration", "timestamp", "json"]) expect(isValueType(t)).toBe(true);
    for (const t of ["int128", "json[]", "duration[]", "", "float[][]"]) expect(isValueType(t)).toBe(false);
  });
});

test("the table has at least 100 type cases (M04-T02)", () => {
  expect(ARITHMETIC.length + COMPARISON.length + ASSIGN.length + CALLS.length).toBeGreaterThanOrEqual(100);
});
