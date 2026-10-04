/** Duration units offered by `sv-duration`; the stored value is always integer milliseconds. */
export const SV_DURATION_UNITS = [
  { id: 'ms', label: 'ms', factor: 1 },
  { id: 's', label: 's', factor: 1000 },
  { id: 'min', label: 'min', factor: 60_000 },
] as const
export type SvDurationUnit = (typeof SV_DURATION_UNITS)[number]['id']

/** Largest duration: uint32 milliseconds (~49.7 days), ADR-0015 `duration(ms)`. */
export const SV_DURATION_MAX_MS = 2 ** 32 - 1

export type SvDurationParse = { ok: true; ms: number } | { ok: false; error: string }

/**
 * `2` + `s` → 2000 ms. Fractions are allowed when the result is a whole number of milliseconds
 * (`1.5 s`), never rounded (`0.5 ms` is an error).
 */
export function parseDuration(raw: string, unit: SvDurationUnit, min = 0): SvDurationParse {
  const text = raw.trim()
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return { ok: false, error: 'Enter a number' }
  const factor = BigInt(SV_DURATION_UNITS.find((u) => u.id === unit)?.factor ?? 1)
  // Exact decimal arithmetic: 1.1 s is 1100 ms (floats would give 1100.0000000000002).
  const [int, frac = ''] = text.split('.')
  const scaled = BigInt(int + frac) * factor
  const divisor = 10n ** BigInt(frac.length)
  if (scaled % divisor !== 0n) return { ok: false, error: 'Must be a whole number of milliseconds' }
  const exact = scaled / divisor
  if (exact > BigInt(SV_DURATION_MAX_MS)) return { ok: false, error: 'Too long (max ~49 days)' }
  const whole = Number(exact)
  if (whole < min) return { ok: false, error: `Must be at least ${formatDuration(min)}` }
  return { ok: true, ms: whole }
}

/** Largest unit that represents `ms` exactly: 2000 → 2 s, 1500 → 1500 ms, 120000 → 2 min. */
export function splitDuration(ms: number): { value: string; unit: SvDurationUnit } {
  for (const u of [...SV_DURATION_UNITS].reverse()) {
    if (ms !== 0 && ms % u.factor === 0) return { value: String(ms / u.factor), unit: u.id }
  }
  return { value: String(ms), unit: 'ms' }
}

export function formatDuration(ms: number): string {
  const { value, unit } = splitDuration(ms)
  return `${value} ${unit}`
}
