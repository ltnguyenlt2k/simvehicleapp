/**
 * VSS unit table with exact conversion factors (ADR-0015 §5–§6 + Notes 2026-10-06 §8).
 *
 * VSS `units.yaml` gives every unit a quantity but no conversion factor; the factors below are
 * exact rationals to the quantity's base unit: `base = value × factor + offset`. Only units of the
 * same quantity *and* the same linear `group` convert; logarithmic (dB), calendar (months/years) and
 * representation-specific (unix-time/iso8601) units stand alone.
 */

/** Exact rational p/q (q > 0), from a decimal or fraction literal. */
export interface Rational {
  p: bigint;
  q: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};

export function rat(p: bigint, q = 1n): Rational {
  if (q === 0n) throw new Error("rational with zero denominator");
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  const g = gcd(p, q) || 1n;
  return { p: p / g, q: q / g };
}

/** "0.0254", "1/3.6" → exact rational. */
export function parseRational(text: string): Rational {
  const [num, den] = text.split("/");
  const dec = (s: string): Rational => {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim());
    if (!m) throw new Error(`not a decimal: ${s}`);
    const frac = m[3] ?? "";
    const p = BigInt(`${m[1]}${m[2]}${frac}`);
    return rat(p, 10n ** BigInt(frac.length));
  };
  const a = dec(num!);
  if (den === undefined) return a;
  const b = dec(den);
  return rat(a.p * b.q, a.q * b.p);
}

const div = (a: Rational, b: Rational) => rat(a.p * b.q, a.q * b.p);
const sub = (a: Rational, b: Rational) => rat(a.p * b.q - b.p * a.q, a.q * b.q);

/** Nearest double of an exact rational (one IEEE division of two exactly representable integers). */
export function toDouble(r: Rational): number {
  const LIMIT = 2n ** 53n;
  if (r.p > LIMIT || r.p < -LIMIT || r.q > LIMIT) throw new Error(`rational ${r.p}/${r.q} is outside the exact double range`);
  return Number(r.p) / Number(r.q);
}

export interface UnitDef {
  /** VSS quantity (`quantities.yaml`, v4.2 `units.yaml#quantity`). */
  quantity: string;
  /** Units convert only within the same quantity and group. */
  group: string;
  factor: Rational;
  offset: Rational;
}

const R = parseRational;
const ZERO = rat(0n);
type Row = [unit: string, quantity: string, factor: string, offset?: string, group?: string];

/** Every unit of VSS v4.0 and v4.2 (`fixtures/vss/units.yaml`, `v4.2/units.yaml`). */
const ROWS: Row[] = [
  ["mm", "length", "0.001"],
  ["cm", "length", "0.01"],
  ["m", "length", "1"],
  ["km", "length", "1000"],
  ["inch", "length", "0.0254"],
  ["km/h", "velocity", "1/3.6"],
  ["m/s", "velocity", "1"],
  ["m/s^2", "acceleration", "1"],
  ["cm/s^2", "acceleration", "0.01"],
  ["ml", "volume", "0.001"],
  ["l", "volume", "1"],
  ["cm^3", "volume", "0.001"],
  ["celsius", "temperature", "1", "273.15"],
  ["degrees", "angle", "1"],
  ["degrees/s", "angular-speed", "1"],
  ["W", "power", "1"],
  ["kW", "power", "1000"],
  ["PS", "power", "735.49875"],
  ["kWh", "work", "1"],
  ["g", "mass", "0.001"],
  ["kg", "mass", "1"],
  ["lbs", "mass", "0.45359237"],
  ["V", "voltage", "1"],
  ["A", "electric-current", "1"],
  ["Ah", "electric-charge", "1"],
  ["ms", "duration", "0.001"],
  ["s", "duration", "1"],
  ["min", "duration", "60"],
  ["h", "duration", "3600"],
  ["day", "duration", "86400"],
  ["weeks", "duration", "604800"],
  ["months", "duration", "1", undefined, "calendar-months"],
  ["years", "duration", "1", undefined, "calendar-years"],
  ["unix-time", "datetime", "1", undefined, "unix-time"],
  ["UNIX Timestamp", "datetime", "1", undefined, "unix-time"],
  ["iso8601", "datetime", "1", undefined, "iso8601"],
  ["mbar", "pressure", "100"],
  ["Pa", "pressure", "1"],
  ["kPa", "pressure", "1000"],
  ["psi", "pressure", "4.4482216152605/0.00064516"], // lbf / in², exact by definition
  ["stars", "rating", "1"],
  ["g/s", "mass-per-time", "1"],
  ["g/km", "mass-per-distance", "1"],
  ["kWh/100km", "energy-consumption-per-distance", "10"],
  ["Wh/km", "energy-consumption-per-distance", "1"],
  ["ml/100km", "volume-per-distance", "0.001"],
  ["l/100km", "volume-per-distance", "1"],
  ["l/h", "volume-flow-rate", "1"],
  ["mpg", "distance-per-volume", "1"],
  ["N", "force", "1"],
  ["kN", "force", "1000"],
  ["Nm", "torque", "1"],
  ["rpm", "rotational-speed", "1"],
  ["Hz", "frequency", "1"],
  ["cpm", "frequency", "1/60"],
  ["bpm", "frequency", "1/60"],
  ["ratio", "relation", "1"],
  ["percent", "relation", "0.01"],
  ["nm/km", "relation", "0.000000000001"],
  ["dBm", "relation", "1", undefined, "dBm"],
  ["dB", "relation", "1", undefined, "dB"],
  ["Ohm", "resistance", "1"],
];

export const UNITS: ReadonlyMap<string, UnitDef> = new Map(
  ROWS.map(([u, quantity, factor, offset, group]) => [
    u,
    { quantity, group: group ?? quantity, factor: R(factor), offset: offset ? R(offset) : ZERO },
  ]),
);

/** SVX literal spellings that are not VSS unit keys (`20 %`, ADR-0013 Notes). */
const ALIASES: Readonly<Record<string, string>> = { "%": "percent" };

/** The VSS unit key of a unit written after a number literal, or of a signal's unit. */
export const canonicalUnit = (u: string): string | undefined => {
  const key = Object.hasOwn(ALIASES, u) ? ALIASES[u]! : u;
  return UNITS.has(key) ? key : undefined;
};

export interface Conversion {
  from: string;
  to: string;
  /** `to = from × scale + offset`, exact. */
  exact: { scale: Rational; offset: Rational };
  /** The same, rounded once to the nearest double (what the IR carries). */
  scale: number;
  offset: number;
  identity: boolean;
}

export type ConversionError = { reason: "unknown_unit"; unit: string } | { reason: "dimension_mismatch"; from: string; to: string };

/** How to convert a value in `from` to `to` (ADR-0015 §5, Notes §8). */
export function conversion(from: string, to: string): Conversion | ConversionError {
  const fk = canonicalUnit(from);
  const tk = canonicalUnit(to);
  if (!fk) return { reason: "unknown_unit", unit: from };
  if (!tk) return { reason: "unknown_unit", unit: to };
  const f = UNITS.get(fk)!;
  const t = UNITS.get(tk)!;
  if (f.quantity !== t.quantity || f.group !== t.group) return { reason: "dimension_mismatch", from: fk, to: tk };
  // base = v·f.factor + f.offset ; to = (base − t.offset) / t.factor
  const scale = div(f.factor, t.factor);
  const offset = div(sub(f.offset, t.offset), t.factor);
  return { from: fk, to: tk, exact: { scale, offset }, scale: toDouble(scale), offset: toDouble(offset), identity: fk === tk || (scale.p === scale.q && offset.p === 0n) };
}

/** Converts a number (simulator/tests); backends evaluate the same `v * scale + offset` in IEEE double. */
export function convert(value: number, c: Pick<Conversion, "scale" | "offset">): number {
  return value * c.scale + c.offset;
}

