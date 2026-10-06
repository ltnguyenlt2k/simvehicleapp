import { integerBounds, isIntegerType, type IntegerType } from "@simvehicleapp/types";

/**
 * Runtime values and IR expression evaluation (IR_SPEC.md "Semantics every backend implements",
 * ADR-0015 Notes §7). Integer-typed values are `bigint` so int64/uint64 stay exact; floats are
 * `number`; `float` results are rounded to binary32 with `Math.fround`.
 */
export type Value = bigint | number | string | boolean | null | Value[] | { [k: string]: Value };
export type Expr = Record<string, unknown>;

export interface EvalContext {
  ref(nodeId: string, output: string): Value;
  signal(id: string): Value | undefined;
  state(id: string): Value;
  now(): number;
  /** Static type of `$ref`/`$signal`/`$state` (for formatting and conversions). */
  typeOfRef(e: Expr): string | undefined;
}

export class EvalError extends Error {
  constructor(
    readonly reason: "no_value" | "array_index_out_of_range",
    message: string,
  ) {
    super(message);
  }
}

const isTime = (t: string) => t === "duration" || t === "timestamp";
const isIntLike = (t: string) => isIntegerType(t) || isTime(t);

/** A JSON/scenario value converted to the runtime representation of `type`. */
export function fromJson(v: unknown, type: string): Value {
  if (v === null || v === undefined) return null;
  if (type.endsWith("[]")) return (v as unknown[]).map((x) => fromJson(x, type.slice(0, -2)));
  if (isIntLike(type)) return typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.trunc(v) : String(v));
  if (type === "float") return Math.fround(Number(v));
  if (type === "double") return Number(v);
  if (type === "boolean") return Boolean(v);
  if (type === "string") return String(v);
  return v as Value;
}

/** Runtime value to JSON for writes/trace: int64/uint64 (and wider than 2^53) as decimal strings. */
export function toJson(v: Value, type?: string): unknown {
  if (typeof v === "bigint") {
    if (type === "int64" || type === "uint64") return v.toString();
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  if (Array.isArray(v)) return v.map((x) => toJson(x, type?.endsWith("[]") ? type.slice(0, -2) : undefined));
  return v;
}

const num = (v: Value): number => (typeof v === "bigint" ? Number(v) : Number(v));
const big = (v: Value): bigint => (typeof v === "bigint" ? v : BigInt(Math.trunc(Number(v))));

/** Shortest decimal that round-trips `x` as binary32 (template formatting of `float`). */
export function formatFloat32(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  for (let p = 1; p <= 9; p++) {
    const s = Number(x.toPrecision(p));
    if (Math.fround(s) === x) return String(s);
  }
  return String(x);
}

/** Template formatting (IR_SPEC "Formatting in templates"). */
export function format(v: Value, type?: string): string {
  if (v === null) return "";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return type === "float" ? formatFloat32(v) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  return JSON.stringify(toJson(v, type));
}

/** Round half away from zero (ADR-0014 Notes §11). */
export function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** `type.cast` (ADR-0014 Notes §11): real ⇒ integer rounds half away from zero, NaN ⇒ 0, clamp. */
export function cast(v: Value, to: string): Value {
  if (isIntegerType(to)) {
    const { min, max } = integerBounds(to as IntegerType);
    let b: bigint;
    if (typeof v === "bigint") b = v;
    else {
      const x = Number(v);
      if (Number.isNaN(x)) b = 0n;
      else if (x === Infinity) b = max;
      else if (x === -Infinity) b = min;
      else b = BigInt(roundHalfAway(x));
    }
    return b < min ? min : b > max ? max : b;
  }
  if (to === "float") return Math.fround(num(v));
  if (to === "double") return num(v);
  if (to === "string") return format(v);
  if (to === "boolean") return Boolean(v);
  return v;
}

/** Converts a computed value to the declared result type of an operator. */
function asType(v: number | bigint, type: string): Value {
  if (isIntLike(type)) return big(v);
  if (type === "float") return Math.fround(Number(v));
  return Number(v);
}

function compare(op: string, l: Value, r: Value): boolean {
  if ((typeof l === "bigint" || typeof l === "number") && (typeof r === "bigint" || typeof r === "number")) {
    if (typeof l === "bigint" && typeof r === "bigint") {
      switch (op) {
        case "==": return l === r;
        case "!=": return l !== r;
        case "<": return l < r;
        case "<=": return l <= r;
        case ">": return l > r;
        default: return l >= r;
      }
    }
    const a = num(l);
    const b = num(r);
    switch (op) {
      case "==": return a === b;
      case "!=": return a !== b;
      case "<": return a < b;
      case "<=": return a <= b;
      case ">": return a > b;
      default: return a >= b;
    }
  }
  return op === "==" ? l === r : op === "!=" ? l !== r : false;
}

/** Static result type of an expression (for formatting). */
export function exprType(e: unknown, ctx: EvalContext): string | undefined {
  if (!e || typeof e !== "object") return undefined;
  const o = e as Expr;
  if ("$const" in o) return o.type as string;
  if ("$expr" in o) return (o.$expr as Expr).type as string;
  if ("$template" in o) return "string";
  return ctx.typeOfRef(o);
}

export function evaluate(e: unknown, ctx: EvalContext): Value {
  const o = e as Expr;
  if ("$const" in o) return fromJson(o.$const, o.type as string);
  if ("$ref" in o) {
    const [node, ...out] = String(o.$ref).split(".");
    return ctx.ref(node!, out.join("."));
  }
  if ("$signal" in o) {
    const v = ctx.signal(String(o.$signal));
    if (v === undefined) throw new EvalError("no_value", `signal ${String(o.$signal)} has no value yet`);
    return v;
  }
  if ("$state" in o) return ctx.state(String(o.$state));
  if ("$template" in o) return (o.$template as unknown[]).map((p) => (typeof p === "string" ? p : format(evaluate(p, ctx), exprType(p, ctx)))).join("");
  const x = o.$expr as Expr & { op: string; type: string };
  const ev = (k: string) => evaluate(x[k], ctx);
  const args = () => (x.args as unknown[]).map((a) => evaluate(a, ctx));
  switch (x.op) {
    case "+":
    case "-":
    case "*": {
      const l = ev("l");
      const r = ev("r");
      if (isIntLike(x.type)) {
        const a = big(l);
        const b = big(r);
        return x.op === "+" ? a + b : x.op === "-" ? a - b : a * b;
      }
      const a = num(l);
      const b = num(r);
      return asType(x.op === "+" ? a + b : x.op === "-" ? a - b : a * b, x.type);
    }
    case "/":
      return num(ev("l")) / num(ev("r"));
    case "%":
      return num(ev("l")) % num(ev("r"));
    case "neg": {
      const a = ev("a");
      return typeof a === "bigint" ? -a : -num(a);
    }
    case "==":
    case "!=":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return compare(x.op, ev("l"), ev("r"));
    case "&&":
      return ev("l") === true && ev("r") === true;
    case "||":
      return ev("l") === true || ev("r") === true;
    case "!":
      return ev("a") !== true;
    case "?:":
      return ev("cond") === true ? ev("then") : ev("else");
    case "abs": {
      const [a] = args();
      return typeof a === "bigint" ? (a < 0n ? -a : a) : Math.abs(num(a!));
    }
    case "min":
    case "max": {
      const vs = args();
      if (isIntLike(x.type)) return vs.map(big).reduce((m, v) => (x.op === "min" ? (v < m ? v : m) : v > m ? v : m));
      return asType(x.op === "min" ? Math.min(...vs.map(num)) : Math.max(...vs.map(num)), x.type);
    }
    case "clamp": {
      const [v, lo, hi] = args();
      if (isIntLike(x.type)) {
        const a = big(v!);
        const l = big(lo!);
        const h = big(hi!);
        return a < l ? l : a > h ? h : a;
      }
      return asType(Math.min(Math.max(num(v!), num(lo!)), num(hi!)), x.type);
    }
    case "round": {
      const [v, d] = args();
      if (d === undefined) return roundHalfAway(num(v!));
      const f = 10 ** Number(d);
      return roundHalfAway(num(v!) * f) / f;
    }
    case "floor":
      return Math.floor(num(args()[0]!));
    case "ceil":
      return Math.ceil(num(args()[0]!));
    case "scale": {
      const [v, a, b, c, d] = args().map(num) as [number, number, number, number, number];
      return c + ((v - a) * (d - c)) / (b - a);
    }
    case "in_range": {
      const [v, lo, hi] = args();
      return compare(">=", v!, lo!) && compare("<=", v!, hi!);
    }
    case "now_ms":
      return BigInt(ctx.now());
    case "array.len":
      return BigInt((ev("value") as Value[]).length);
    case "array.contains": {
      const item = ev("item");
      return (ev("value") as Value[]).some((v) => compare("==", v, item));
    }
    case "array.at":
    case "array.index": {
      const arr = ev("value") as Value[];
      const i = Number(big(ev("index")));
      if (i >= 0 && i < arr.length) return arr[i]!;
      if (x.op === "array.at" && x.default !== undefined) return ev("default");
      throw new EvalError("array_index_out_of_range", `index ${i} is outside 0…${arr.length - 1}`);
    }
    case "unit.convert": {
      const v = num(ev("value"));
      return v * num(evaluate(x.scale, ctx)) + num(evaluate(x.offset, ctx));
    }
    case "type.cast":
      return cast(ev("value"), String(x.to));
    case "json.string":
      return JSON.stringify(String(format(ev("value"))));
    default:
      throw new Error(`simulator: unknown expression op ${x.op}`);
  }
}
