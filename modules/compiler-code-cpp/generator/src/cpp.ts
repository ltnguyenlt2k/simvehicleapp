/**
 * C++ building blocks of the generator (ADR-0022 §5, §7): string literals, identifiers, literal
 * values and the VSS ⇒ C++ type map. Every user string reaches the output only through `cppString`.
 */

/** C++ keywords and alternative tokens (C++20) that a generated identifier must never be. */
const KEYWORDS = new Set(
  (
    "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class " +
    "compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default " +
    "delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long " +
    "mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register " +
    "reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this " +
    "thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor " +
    "xor_eq final override main std rt c w"
  ).split(" "),
);

/**
 * A C++ string literal of `s`: `"…"` with `\\ \" \n \r \t` escaped, other control characters and
 * everything outside printable ASCII as `\u`/`\U` universal names (UTF-8 in the compiled string).
 * A `?` is escaped too so no trigraph or `??` sequence can appear.
 */
export function cppString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (ch === "?") out += "\\?";
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp < 0xa0) out += `\\x${cp.toString(16).padStart(2, "0")}""`; // split so the next char is not a hex digit
    else if (cp >= 0xd800 && cp <= 0xdfff) out += "\\uFFFD"; // lone surrogate
    else if (cp <= 0xffff) out += `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    else out += `\\U${cp.toString(16).toUpperCase().padStart(8, "0")}`;
  }
  return `${out}"`;
}

/**
 * User text inside a C++ comment: printable ASCII only (others as `?`), no comment terminator, no
 * backslash (a trailing one would splice the next line into a `//` comment).
 */
export function commentText(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "/").replace(/\*\//g, "* /");
}

/** `[A-Za-z0-9_]` only, not starting with a digit, never a keyword or a reserved `__`/`_X` name. */
export function sanitizeIdent(raw: string, fallback = "x"): string {
  let s = raw.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}_${s}`;
  if (KEYWORDS.has(s)) s = `${s}_`;
  return s;
}

/** `IsSignaling` ⇒ `is_signaling`, `Row1` ⇒ `row1`, `HVAC` ⇒ `hvac`. */
export function snakeCase(raw: string): string {
  return sanitizeIdent(
    raw
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .toLowerCase(),
  );
}

/** `Stable Overspeed Warning` ⇒ `StableOverspeedWarning` (identifiers of classes/files). */
export function pascalCase(raw: string, fallback = "Workflow"): string {
  const words = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let s = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}${s}`;
  return sanitizeIdent(s, fallback);
}

const INT_TYPES: Record<string, string> = {
  int8: "int8_t",
  int16: "int16_t",
  int32: "int32_t",
  int64: "int64_t",
  uint8: "uint8_t",
  uint16: "uint16_t",
  uint32: "uint32_t",
  uint64: "uint64_t",
};

export const isIntLike = (t: string) => t in INT_TYPES || t === "duration" || t === "timestamp";
export const isArray = (t: string) => t.endsWith("[]");

/** The C++ type of a value as the runtime holds it (VSS type map, ADR-0022 §2). */
export function cppType(t: string): string {
  if (isArray(t)) return `std::vector<${cppType(t.slice(0, -2))}>`;
  if (t in INT_TYPES) return INT_TYPES[t]!;
  if (t === "duration" || t === "timestamp") return "int64_t";
  if (t === "float") return "float";
  if (t === "double") return "double";
  if (t === "boolean") return "bool";
  if (t === "string") return "std::string";
  if (t === "json") return "rt::Value";
  throw new Error(`compiler-code-cpp: no C++ type for ${t}`);
}

/**
 * The C++ type expressions of an integer-like value evaluate in: every integer is exact `int64`
 * arithmetic (ADR-0015 Notes §7) except `uint64` values, which stay `uint64_t`.
 */
export function evalType(t: string): string {
  if (isIntLike(t)) return t === "uint64" ? "uint64_t" : "int64_t";
  return cppType(t);
}

/** Shortest decimal of a double as a C++ floating literal (JS `String(x)` digits, exact round trip). */
export function doubleLiteral(x: number): string {
  if (!Number.isFinite(x)) {
    if (Number.isNaN(x)) return "std::numeric_limits<double>::quiet_NaN()";
    return x > 0 ? "std::numeric_limits<double>::infinity()" : "(-std::numeric_limits<double>::infinity())";
  }
  if (Object.is(x, -0)) return "(-0.0)";
  const s = String(x);
  const lit = /[.e]/.test(s) ? s : `${s}.0`;
  return x < 0 ? `(${lit})` : lit;
}

/** Integer literal of a decimal string/number as `int64_t{…}` / `uint64_t{…}` (no overflow at INT64_MIN). */
export function intLiteral(v: string | number | bigint, t: string): string {
  const b = BigInt(typeof v === "number" ? Math.trunc(v) : v);
  if (t === "uint64" || b > 9223372036854775807n) return `uint64_t{${b}ULL}`;
  if (b === -9223372036854775808n) return "(-int64_t{9223372036854775807} - 1)";
  return b < 0n ? `int64_t{${b}}` : `int64_t{${b}}`;
}
