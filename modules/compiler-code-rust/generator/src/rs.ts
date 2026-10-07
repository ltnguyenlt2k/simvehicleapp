import { atom, call, flat, type Node, prefix } from "./layout.ts";

/**
 * Rust building blocks of the generator (ADR-0041, rules of ADR-0022 §5/§7): string literals, identifiers and
 * literal values. Every user string reaches the output only through `rsString`; the generated source is ASCII.
 */

/** Rust keywords (strict, reserved, 2021 edition) and names generated code itself uses. */
const KEYWORDS = new Set(
  (
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut " +
    "pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final " +
    "macro override priv try typeof unsized virtual yield union c w v runtime Runtime Value bind"
  ).split(" "),
);

/**
 * A Rust string literal of `s` in ASCII: `\\` `"` `\n` `\r` `\t` escaped, other non-printable or non-ASCII
 * characters as `\u{…}` (a lone surrogate becomes U+FFFD: Rust strings are valid UTF-8).
 */
export function rsString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\\u{fffd}";
    else out += `\\u{${cp.toString(16)}}`;
  }
  return `${out}"`;
}

/** User text inside a `//` comment: printable ASCII only (others as `?`), no backslash. */
export function commentText(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "/");
}

/** `[A-Za-z0-9_]` only, not starting with a digit, never a keyword or a name generated code uses. */
export function sanitizeIdent(raw: string, fallback = "x"): string {
  let s = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}_${s}`;
  if (KEYWORDS.has(s)) s = `${s}_`;
  return s;
}

/** `IsSignaling` ⇒ `is_signaling`, `Row1` ⇒ `row1`, `HVAC` ⇒ `hvac`. */
export function snakeCase(raw: string, fallback = "x"): string {
  return sanitizeIdent(
    raw
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase(),
    fallback,
  );
}

const INT_TYPES = new Set(["int8", "int16", "int32", "int64", "uint8", "uint16", "uint32", "uint64"]);
export const isIntLike = (t: string) => INT_TYPES.has(t) || t === "duration" || t === "timestamp";
export const isArray = (t: string) => t.endsWith("[]");

/** A double as a Rust `f64` expression with the same value (JS `String(x)` digits round-trip exactly). */
export function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return "f64::NAN";
  if (!Number.isFinite(x)) return x > 0 ? "f64::INFINITY" : "f64::NEG_INFINITY";
  if (Object.is(x, -0)) return "-0.0";
  const s = String(x);
  return /[.e]/.test(s) ? s.replace(/e\+/, "e") : `${s}.0`;
}

/** An integer (decimal string or number) as a Rust `i128` literal. */
export function intLiteral(v: string | number | bigint): string {
  return `${BigInt(typeof v === "number" ? Math.trunc(v) : v)}`;
}

const valueOf = (variant: string, inner: string) => atom(`Value::${variant}(${inner})`);

/** A `$const` of IR type `type` as a Rust `Value` expression (simulator `fromJson`). */
export function constNode(v: unknown, type: string): Node {
  if (v === null || v === undefined) return atom("Value::Null");
  if (isArray(type)) return call("Value::Array", [call("vec!", (v as unknown[]).map((x) => constNode(x, type.slice(0, -2))))].map(bracketVec));
  if (isIntLike(type)) return valueOf("Int", intLiteral(typeof v === "bigint" ? v : typeof v === "number" ? Math.trunc(v) : String(v)));
  if (type === "float") return valueOf("Float", floatLiteral(Math.fround(Number(v))));
  if (type === "double") return valueOf("Float", floatLiteral(Number(v)));
  if (type === "boolean") return valueOf("Bool", v ? "true" : "false");
  if (type === "string") return call("Value::str", [atom(rsString(String(v)))]);
  return jsonNode(v);
}

/** `vec!(…)` as `vec![…]`. */
function bracketVec(n: Node): Node {
  return n.kind === "group" && n.head === "vec!" ? { ...n, open: "[", close: "]" } : n;
}

/** Any JSON value as a Rust `Value` expression (`json` type, initial values, scenarios). */
export function jsonNode(v: unknown): Node {
  if (v === null || v === undefined) return atom("Value::Null");
  if (typeof v === "boolean") return valueOf("Bool", v ? "true" : "false");
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER && !Object.is(v, -0) ? valueOf("Int", intLiteral(v)) : valueOf("Float", floatLiteral(v));
  if (typeof v === "string") return call("Value::str", [atom(rsString(v))]);
  if (Array.isArray(v)) return call("Value::Array", [bracketVec(call("vec!", v.map(jsonNode)))]);
  const o = v as Record<string, unknown>;
  return call("Value::obj", [
    bracketVec(
      call(
        "vec!",
        Object.keys(o).map((k) => ({ kind: "group", head: "", open: "(", items: [atom(rsString(k)), jsonNode(o[k])], close: ")", display: false }) as Node),
      ),
    ),
  ]);
}

export const constLiteral = (v: unknown, type: string) => flat(constNode(v, type));
export const jsonLiteral = (v: unknown) => flat(jsonNode(v));
export { prefix };
