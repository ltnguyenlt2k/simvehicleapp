import type { SignalMeta } from "./catalog.ts";

/**
 * JSON values ⇄ kuksa.val.v1 `Datapoint` (types.proto oneof `value`). int64/uint64 travel as decimal
 * strings in JSON (ADR-0018) and as strings to protobuf; narrower integers are range-checked before the
 * databroker sees them, so a bad inject gets a clear message instead of a gRPC error.
 */

export type Datapoint = Record<string, unknown>;

const INT: Record<string, [bigint, bigint, string]> = {
  int8: [-128n, 127n, "int32"],
  int16: [-32768n, 32767n, "int32"],
  int32: [-2147483648n, 2147483647n, "int32"],
  int64: [-9223372036854775808n, 9223372036854775807n, "int64"],
  uint8: [0n, 255n, "uint32"],
  uint16: [0n, 65535n, "uint32"],
  uint32: [0n, 4294967295n, "uint32"],
  uint64: [0n, 18446744073709551615n, "uint64"],
};

export type Converted = { ok: true; datapoint: Datapoint } | { ok: false; message: string };

function scalar(base: string, v: unknown): { ok: true; field: string; value: unknown } | { ok: false; message: string } {
  if (base === "boolean") return typeof v === "boolean" ? { ok: true, field: "bool", value: v } : { ok: false, message: "expects true or false" };
  if (base === "string") return typeof v === "string" ? { ok: true, field: "string", value: v } : { ok: false, message: "expects a string" };
  if (base === "float" || base === "double") {
    return typeof v === "number" && Number.isFinite(v) ? { ok: true, field: base, value: v } : { ok: false, message: "expects a number" };
  }
  const range = INT[base];
  if (!range) return { ok: false, message: `datatype ${base} is not supported` };
  let n: bigint;
  if (typeof v === "number" && Number.isInteger(v)) n = BigInt(v);
  else if (typeof v === "string" && /^-?[0-9]+$/.test(v)) n = BigInt(v);
  else return { ok: false, message: `expects an integer (${base})` };
  if (n < range[0] || n > range[1]) return { ok: false, message: `out of range for ${base} (${range[0]}…${range[1]})` };
  const big = range[2] === "int64" || range[2] === "uint64";
  return { ok: true, field: range[2], value: big ? n.toString() : Number(n) };
}

/** Datapoint for `value` of signal `meta`, or why it does not fit (type, range, min/max, allowed). */
export function toDatapoint(meta: SignalMeta, value: unknown): Converted {
  const array = meta.datatype.endsWith("[]");
  const base = array ? meta.datatype.slice(0, -2) : meta.datatype;
  const check = (v: unknown): string | null => {
    if (meta.allowed && !meta.allowed.includes(v)) return `not one of ${meta.allowed.map(String).join(", ")}`;
    const num = typeof v === "number" ? v : typeof v === "string" && /^-?[0-9]+$/.test(v) ? Number(v) : undefined;
    if (num !== undefined && meta.min !== undefined && num < meta.min) return `below the minimum ${meta.min}`;
    if (num !== undefined && meta.max !== undefined && num > meta.max) return `above the maximum ${meta.max}`;
    return null;
  };
  if (array) {
    if (!Array.isArray(value)) return { ok: false, message: `${meta.path} expects an array (${meta.datatype})` };
    const field = base === "boolean" ? "bool" : base === "string" || base === "float" || base === "double" ? base : INT[base]?.[2];
    if (!field) return { ok: false, message: `datatype ${meta.datatype} is not supported` };
    const values: unknown[] = [];
    for (const item of value) {
      const s = scalar(base, item);
      if (!s.ok) return { ok: false, message: `${meta.path}: ${s.message}` };
      const bad = check(item);
      if (bad) return { ok: false, message: `${meta.path}: ${String(item)} is ${bad}` };
      values.push(s.value);
    }
    return { ok: true, datapoint: { [`${field}_array`]: { values } } };
  }
  const s = scalar(base, value);
  if (!s.ok) return { ok: false, message: `${meta.path} ${s.message}` };
  const bad = check(value);
  if (bad) return { ok: false, message: `${meta.path}: ${String(value)} is ${bad}` };
  return { ok: true, datapoint: { [s.field]: s.value } };
}

/** JSON value of a decoded Datapoint (proto-loader `oneofs: true` sets `value` to the field name). */
export function fromDatapoint(dp: Datapoint | null | undefined): unknown {
  if (!dp || typeof dp.value !== "string") return null;
  const v = dp[dp.value];
  if (dp.value.endsWith("_array")) return ((v as { values?: unknown[] } | undefined)?.values ?? []).map((x) => normalize(dp.value as string, x));
  return normalize(dp.value, v);
}

const normalize = (field: string, v: unknown) => (field.startsWith("int64") || field.startsWith("uint64") ? String(v) : v);

/** Epoch ms of a protobuf Timestamp (`seconds` arrives as a string with `longs: String`). */
export function timestampMs(ts: { seconds?: string | number; nanos?: number } | null | undefined): number | undefined {
  if (!ts) return undefined;
  return Number(ts.seconds ?? 0) * 1000 + Math.floor((ts.nanos ?? 0) / 1e6);
}
