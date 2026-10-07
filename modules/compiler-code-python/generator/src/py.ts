import { atom, display, flat, type Node, prefix } from "./layout.ts";

/**
 * Python building blocks of the generator (ADR-0040 §3, same rules as ADR-0022 §5/§7 for C++): string
 * literals, identifiers and literal values. Every user string reaches the output only through `pyString`,
 * and the generated source is ASCII only.
 */

/** Python keywords, soft keywords and the names generated code itself uses. */
const KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except finally for from " +
    "global if import in is lambda nonlocal not or pass raise return try while with yield match case type _ " +
    "V c w rt runtime Runtime math"
  ).split(" "),
);

/**
 * A Python string literal of `s` in ASCII: `\\`, the quote and `\n \r \t` escaped, other controls as `\x`,
 * non-ASCII as `\u`/`\U` (a lone surrogate becomes U+FFFD: it could not be written as UTF-8). Double quotes
 * unless the text has more `"` than `'` — the quote `ruff format` keeps.
 */
export function pyString(s: string): string {
  const q = [...s].filter((c) => c === '"').length > [...s].filter((c) => c === "'").length ? "'" : '"';
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += `\\${q}`;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp < 0x100) out += `\\x${cp.toString(16).padStart(2, "0")}`;
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\\ufffd";
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).padStart(4, "0")}`;
    else out += `\\U${cp.toString(16).padStart(8, "0")}`;
  }
  return out + q;
}

/** User text inside a `#` comment or a docstring: printable ASCII only (others as `?`), no backslash or quotes run. */
export function commentText(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "/").replace(/"""/g, '""?');
}

/** `[A-Za-z0-9_]` only, not starting with a digit, never a keyword or a dunder name. */
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

/** A double as a Python float literal with the same value (JS `String(x)` digits are the shortest round trip). */
export function floatLiteral(x: number): string {
  if (Number.isNaN(x)) return 'float("nan")';
  if (!Number.isFinite(x)) return x > 0 ? 'float("inf")' : '-float("inf")';
  if (Object.is(x, -0)) return "-0.0";
  const s = String(x);
  return /[.e]/.test(s) ? s.replace(/e\+/, "e") : `${s}.0`;
}

/** An integer (decimal string or number) as a Python int literal. */
export function intLiteral(v: string | number | bigint): string {
  return `${BigInt(typeof v === "number" ? Math.trunc(v) : v)}`;
}

/** A `$const` of IR type `type` as Python code of the runtime representation (simulator `fromJson`). */
export function constNode(v: unknown, type: string): Node {
  if (v === null || v === undefined) return atom("None");
  if (isArray(type)) return display("[", (v as unknown[]).map((x) => constNode(x, type.slice(0, -2))));
  if (isIntLike(type)) return atom(intLiteral(typeof v === "bigint" ? v : typeof v === "number" ? Math.trunc(v) : String(v)));
  if (type === "float") return atom(floatLiteral(Math.fround(Number(v))));
  if (type === "double") return atom(floatLiteral(Number(v)));
  if (type === "boolean") return atom(v ? "True" : "False");
  if (type === "string") return atom(pyString(String(v)));
  return jsonNode(v);
}

/** Any JSON value as Python code (`json` type, initial values, scenarios): numbers as the JSON text gives them. */
export function jsonNode(v: unknown): Node {
  if (v === null || v === undefined) return atom("None");
  if (typeof v === "boolean") return atom(v ? "True" : "False");
  if (typeof v === "number") return atom(Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER && !Object.is(v, -0) ? intLiteral(v) : floatLiteral(v));
  if (typeof v === "string") return atom(pyString(v));
  if (Array.isArray(v)) return display("[", v.map(jsonNode));
  const o = v as Record<string, unknown>;
  return display(
    "{",
    Object.keys(o).map((k) => prefix(`${pyString(k)}: `, jsonNode(o[k]))),
  );
}

export const constLiteral = (v: unknown, type: string) => flat(constNode(v, type));
export const jsonLiteral = (v: unknown) => flat(jsonNode(v));
