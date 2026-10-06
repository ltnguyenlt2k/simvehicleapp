/**
 * SimVehicleApp value types and the typing rules every backend shares (ADR-0015 §1–§4 + Notes
 * 2026-10-06 §7, ADR-0018). Pure and deterministic: no I/O, BigInt for integer bounds so int64/uint64
 * are exact.
 */

export const INTEGER_TYPES = ["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64"] as const;
export const FLOAT_TYPES = ["float", "double"] as const;
export const SCALAR_TYPES = ["boolean", ...INTEGER_TYPES, ...FLOAT_TYPES, "string"] as const;
export const INTERNAL_TYPES = ["duration", "timestamp", "json"] as const;

export type IntegerType = (typeof INTEGER_TYPES)[number];
export type FloatType = (typeof FLOAT_TYPES)[number];
export type ScalarType = (typeof SCALAR_TYPES)[number];
export type ArrayType = `${ScalarType}[]`;
/** contracts `common#/$defs/valueType`. */
export type ValueType = ScalarType | ArrayType | (typeof INTERNAL_TYPES)[number];

/** Inclusive integer bounds. */
export interface Range {
  min: bigint;
  max: bigint;
}

const INT_BOUNDS: Record<IntegerType, Range> = {
  int8: { min: -(2n ** 7n), max: 2n ** 7n - 1n },
  int16: { min: -(2n ** 15n), max: 2n ** 15n - 1n },
  int32: { min: -(2n ** 31n), max: 2n ** 31n - 1n },
  int64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
  uint8: { min: 0n, max: 2n ** 8n - 1n },
  uint16: { min: 0n, max: 2n ** 16n - 1n },
  uint32: { min: 0n, max: 2n ** 32n - 1n },
  uint64: { min: 0n, max: 2n ** 64n - 1n },
};
/** Integers in this range convert to/from double exactly (±2^53). */
export const SAFE_DOUBLE_RANGE: Range = { min: -(2n ** 53n), max: 2n ** 53n };

const SET = {
  integer: new Set<string>(INTEGER_TYPES),
  float: new Set<string>(FLOAT_TYPES),
  scalar: new Set<string>(SCALAR_TYPES),
  internal: new Set<string>(INTERNAL_TYPES),
};

export const isIntegerType = (t: string): t is IntegerType => SET.integer.has(t);
export const isFloatType = (t: string): t is FloatType => SET.float.has(t);
export const isArrayType = (t: string): t is ArrayType => t.endsWith("[]") && SET.scalar.has(t.slice(0, -2));
export const isValueType = (t: string): t is ValueType => SET.scalar.has(t) || SET.internal.has(t) || isArrayType(t);
/** ms-based integer types: they behave as integers with a full int64 range. */
export const isTimeType = (t: string): t is "duration" | "timestamp" => t === "duration" || t === "timestamp";
export const isNumericType = (t: string) => isIntegerType(t) || isFloatType(t) || isTimeType(t);
export const elementType = (t: ArrayType): ScalarType => t.slice(0, -2) as ScalarType;
export const integerBounds = (t: IntegerType): Range => INT_BOUNDS[t];

/**
 * What the typer knows about a value: its type, and for integers the range it can take (a literal is
 * a single point, a VSS signal its full datatype range).
 */
export interface TypeInfo {
  type: ValueType;
  range?: Range;
  /** True for a literal written in the source (used to report VALUE_OUT_OF_RANGE instead of narrowing). */
  literal?: boolean;
}

export const typeOf = (type: ValueType): TypeInfo =>
  isIntegerType(type) ? { type, range: INT_BOUNDS[type] } : isTimeType(type) ? { type, range: INT_BOUNDS.int64 } : { type };

/** Type of a numeric literal from its exact source text (`80`, `-3`, `0.5`, `1e3`). */
export function literalType(raw: string): TypeInfo {
  if (/^-?\d+$/.test(raw)) {
    const v = BigInt(raw);
    return { type: "int64", range: { min: v, max: v }, literal: true };
  }
  return { type: "double", literal: true };
}

const within = (r: Range, outer: Range) => r.min >= outer.min && r.max <= outer.max;
const rangeOf = (t: TypeInfo): Range | undefined => t.range ?? (isIntegerType(t.type) ? INT_BOUNDS[t.type] : isTimeType(t.type) ? INT_BOUNDS.int64 : undefined);
const isIntLike = (t: TypeInfo) => isIntegerType(t.type) || isTimeType(t.type);

export type TypeErrorReason =
  | "not_numeric"
  | "not_boolean"
  | "not_comparable"
  | "string_arithmetic"
  | "array_requires_indexing"
  | "integer_overflow"
  | "int64_precision"
  | "time_arithmetic"
  | "not_array"
  | "branch_mismatch";

export type TypeResult = { ok: true; info: TypeInfo } | { ok: false; reason: TypeErrorReason };
const ok = (info: TypeInfo): TypeResult => ({ ok: true, info });
const fail = (reason: TypeErrorReason): TypeResult => ({ ok: false, reason });

function intResult(range: Range): TypeResult {
  return within(range, INT_BOUNDS.int64) ? ok({ type: "int64", range }) : fail("integer_overflow");
}

function minMax(values: bigint[]): Range {
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** A number used where a double is computed: wide integers would lose precision silently. */
function doubleOperand(t: TypeInfo): TypeErrorReason | undefined {
  const r = rangeOf(t);
  return r && !within(r, SAFE_DOUBLE_RANGE) ? "int64_precision" : undefined;
}

function scalarGuard(...ts: TypeInfo[]): TypeErrorReason | undefined {
  return ts.some((t) => isArrayType(t.type)) ? "array_requires_indexing" : undefined;
}

export type ArithmeticOp = "+" | "-" | "*" | "/" | "%";

/** Binary arithmetic (ADR-0015 Notes §7). */
export function arithmetic(op: ArithmeticOp, a: TypeInfo, b: TypeInfo): TypeResult {
  const arr = scalarGuard(a, b);
  if (arr) return fail(arr);
  if (a.type === "string" || b.type === "string") return fail("string_arithmetic");
  if (!isNumericType(a.type) || !isNumericType(b.type)) return fail("not_numeric");

  // duration/timestamp algebra (ms integers)
  if (isTimeType(a.type) || isTimeType(b.type)) {
    const ta = a.type;
    const tb = b.type;
    const time = (type: "duration" | "timestamp"): TypeResult => ok({ type, range: INT_BOUNDS.int64 });
    if (op === "-" && ta === "timestamp" && tb === "timestamp") return time("duration");
    if ((op === "+" || op === "-") && ta === "timestamp" && tb === "duration") return time("timestamp");
    if (op === "+" && ta === "duration" && tb === "timestamp") return time("timestamp");
    if ((op === "+" || op === "-") && ta === "duration" && tb === "duration") return time("duration");
    // duration × integer only: ms stay whole numbers
    const intFactor = (t: TypeInfo) => isIntegerType(t.type);
    if (op === "*" && ((ta === "duration" && intFactor(b)) || (tb === "duration" && intFactor(a)))) return time("duration");
    return fail("time_arithmetic");
  }

  if (op === "/" || op === "%") {
    const p = doubleOperand(a) ?? doubleOperand(b);
    return p ? fail(p) : ok({ type: "double" });
  }
  if (isFloatType(a.type) || isFloatType(b.type)) {
    const p = doubleOperand(a) ?? doubleOperand(b);
    return p ? fail(p) : ok({ type: "double" });
  }
  const ra = rangeOf(a)!;
  const rb = rangeOf(b)!;
  switch (op) {
    case "+":
      return intResult({ min: ra.min + rb.min, max: ra.max + rb.max });
    case "-":
      return intResult({ min: ra.min - rb.max, max: ra.max - rb.min });
    case "*":
      return intResult(minMax([ra.min * rb.min, ra.min * rb.max, ra.max * rb.min, ra.max * rb.max]));
  }
}

export function negate(a: TypeInfo): TypeResult {
  const arr = scalarGuard(a);
  if (arr) return fail(arr);
  if (a.type === "duration") return ok(a);
  if (!isNumericType(a.type) || a.type === "timestamp") return fail("not_numeric");
  if (isFloatType(a.type)) return ok({ type: "double" });
  const r = rangeOf(a)!;
  const res = intResult({ min: -r.max, max: -r.min });
  return res.ok && a.literal ? ok({ ...res.info, literal: true }) : res;
}

export type ComparisonOp = "==" | "!=" | "<" | "<=" | ">" | ">=";
const BOOL: TypeInfo = { type: "boolean" };

/** Comparison ⇒ boolean (numbers compare mathematically; strings/booleans only for equality). */
export function compare(op: ComparisonOp, a: TypeInfo, b: TypeInfo): TypeResult {
  const arr = scalarGuard(a, b);
  if (arr) return fail(arr);
  const numeric = isNumericType(a.type) && isNumericType(b.type);
  if (numeric) {
    if (isTimeType(a.type) !== isTimeType(b.type) && (isTimeType(a.type) ? !isIntLike(b) : !isIntLike(a))) return fail("not_comparable");
    if (isFloatType(a.type) || isFloatType(b.type)) {
      const p = doubleOperand(a) ?? doubleOperand(b);
      if (p) return fail(p);
    }
    return ok(BOOL);
  }
  const equality = op === "==" || op === "!=";
  if (equality && a.type === b.type && (a.type === "string" || a.type === "boolean")) return ok(BOOL);
  return fail("not_comparable");
}

export function logical(a: TypeInfo, b?: TypeInfo): TypeResult {
  return a.type === "boolean" && (!b || b.type === "boolean") ? ok(BOOL) : fail("not_boolean");
}

/** Common type of two values meeting in a ternary or min/max/clamp. */
export function unify(a: TypeInfo, b: TypeInfo): TypeResult {
  const arr = scalarGuard(a, b);
  if (arr) return fail(arr);
  if (a.type === b.type && !isIntLike(a)) return ok({ type: a.type });
  if (isTimeType(a.type) || isTimeType(b.type)) return a.type === b.type ? ok({ type: a.type, range: INT_BOUNDS.int64 }) : fail("branch_mismatch");
  if (isNumericType(a.type) && isNumericType(b.type)) {
    if (isFloatType(a.type) || isFloatType(b.type)) {
      const p = doubleOperand(a) ?? doubleOperand(b);
      return p ? fail(p) : ok({ type: "double" });
    }
    const ra = rangeOf(a)!;
    const rb = rangeOf(b)!;
    return intResult({ min: ra.min < rb.min ? ra.min : rb.min, max: ra.max > rb.max ? ra.max : rb.max });
  }
  return fail("branch_mismatch");
}

export type AssignResult =
  | { ok: true; rounding?: "float32" }
  | { ok: false; reason: "narrowing" | "out_of_range" | "mismatch" | "array_not_writable" };

/**
 * Can a value of `from` be stored as `to` without an explicit Convert? (ADR-0015 §3 + Notes §6–§7)
 * `out_of_range` = a literal that does not fit (reported as VALUE_OUT_OF_RANGE).
 */
export function assignable(from: TypeInfo, to: ValueType): AssignResult {
  if (to === "json") return { ok: true };
  if (isArrayType(to)) return from.type === to ? { ok: true } : { ok: false, reason: "array_not_writable" };
  if (isArrayType(from.type)) return { ok: false, reason: "mismatch" };
  if (from.type === to && !isIntLike(from)) return { ok: true };
  if (isIntegerType(to) || isTimeType(to)) {
    if (!isIntLike(from)) return { ok: false, reason: isFloatType(from.type) ? "narrowing" : "mismatch" };
    if (isTimeType(from.type) && isIntegerType(to) && within(INT_BOUNDS.int64, INT_BOUNDS[to])) return { ok: true };
    const target = isIntegerType(to) ? INT_BOUNDS[to] : INT_BOUNDS.int64;
    if (within(rangeOf(from)!, target)) return { ok: true };
    return { ok: false, reason: from.literal ? "out_of_range" : "narrowing" };
  }
  if (isFloatType(to)) {
    if (!isNumericType(from.type)) return { ok: false, reason: "mismatch" };
    const p = isIntLike(from) ? doubleOperand(from) : undefined;
    if (p) return { ok: false, reason: "narrowing" };
    return to === "float" && from.type !== "float" ? { ok: true, rounding: "float32" } : { ok: true };
  }
  return { ok: false, reason: "mismatch" };
}

/** Result type of a whitelisted SVX function (ADR-0013 §2, ADR-0018 §3, ADR-0015 Notes §7). */
export function callType(name: string, args: TypeInfo[]): TypeResult {
  const arr = (i: number) => args[i] && isArrayType(args[i]!.type);
  switch (name) {
    case "abs": {
      const a = args[0]!;
      if (scalarGuard(a)) return fail("array_requires_indexing");
      if (!isNumericType(a.type) || isTimeType(a.type)) return fail("not_numeric");
      if (isFloatType(a.type)) return ok({ type: "double" });
      const r = rangeOf(a)!;
      const lo = r.min < 0n && r.max > 0n ? 0n : r.min < 0n ? -r.max : r.min;
      const hi = -r.min > r.max ? -r.min : r.max;
      return intResult({ min: lo, max: hi });
    }
    case "min":
    case "max":
    case "clamp": {
      let acc: TypeResult = ok(args[0]!);
      for (const a of args) {
        if (!isNumericType(a.type)) return fail(scalarGuard(a) ?? "not_numeric");
        acc = acc.ok ? unify(acc.info, a) : acc;
      }
      if (acc.ok && isIntLike(acc.info) && !isTimeType(acc.info.type)) return ok({ type: "int64", range: acc.info.range });
      return acc;
    }
    case "round":
    case "floor":
    case "ceil":
    case "scale":
      for (const a of args) {
        if (!isNumericType(a.type) || isTimeType(a.type)) return fail(scalarGuard(a) ?? "not_numeric");
        const p = isIntLike(a) ? doubleOperand(a) : undefined;
        if (p) return fail(p);
      }
      return ok({ type: "double" });
    case "in_range":
      for (const a of args) if (!isNumericType(a.type)) return fail(scalarGuard(a) ?? "not_numeric");
      return ok(BOOL);
    case "now_ms":
      return ok({ type: "timestamp", range: INT_BOUNDS.int64 });
    case "len":
      return arr(0) ? ok({ type: "uint32", range: INT_BOUNDS.uint32 }) : fail("not_array");
    case "contains":
      return arr(0) ? ok(BOOL) : fail("not_array");
    case "at":
      if (!arr(0)) return fail("not_array");
      if (!isIntegerType(args[1]!.type)) return fail("not_numeric");
      return ok(typeOf(elementType(args[0]!.type as ArrayType)));
    default:
      throw new Error(`callType: ${name} is not a whitelisted SVX function`);
  }
}

/** `arr[i]`: element of an array, index must be an integer. */
export function indexType(target: TypeInfo, index: TypeInfo): TypeResult {
  if (!isArrayType(target.type)) return fail("not_array");
  if (!isIntegerType(index.type)) return fail("not_numeric");
  return ok(typeOf(elementType(target.type)));
}
