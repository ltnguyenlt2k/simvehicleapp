import type { SvVssNode } from '@/lib/api/contracts/sv'

/** The 12 VSS scalar datatypes (ADR-0018 §1). */
export const SV_SCALAR_TYPES = [
  'boolean',
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'float',
  'double',
  'string',
] as const
export type SvScalarType = (typeof SV_SCALAR_TYPES)[number]

/** A stored literal: int64/uint64 as decimal strings so JSON keeps every digit (ADR-0018 §7). */
export type SvScalarValue = string | number | boolean

export type SvTypedParseResult = { ok: true; value: SvScalarValue } | { ok: false; error: string }

export type SvValueDomain = Pick<SvVssNode, 'min' | 'max' | 'allowed'>

const INT_RANGE: Partial<Record<SvScalarType, readonly [bigint, bigint]>> = {
  int8: [-(2n ** 7n), 2n ** 7n - 1n],
  int16: [-(2n ** 15n), 2n ** 15n - 1n],
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint8: [0n, 2n ** 8n - 1n],
  uint16: [0n, 2n ** 16n - 1n],
  uint32: [0n, 2n ** 32n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
}
const FLOAT32_MAX = 3.4028234663852886e38
const INTEGER = /^-?(0|[1-9][0-9]*)$/

export function isSvScalarType(value: unknown): value is SvScalarType {
  return typeof value === 'string' && (SV_SCALAR_TYPES as readonly string[]).includes(value)
}

export function is64BitType(type: SvScalarType): boolean {
  return type === 'int64' || type === 'uint64'
}

/** Text shown in an input for a stored literal. */
export function formatTypedValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function checkDomain(value: SvScalarValue, domain?: SvValueDomain): string | undefined {
  if (!domain) return undefined
  if (domain.allowed && domain.allowed.length > 0) {
    return domain.allowed.some((a) => String(a) === String(value))
      ? undefined
      : `Must be one of: ${domain.allowed.map(String).join(', ')}`
  }
  if (typeof value === 'boolean') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  if (domain.min !== undefined && n < domain.min) return `Must be ≥ ${domain.min}`
  if (domain.max !== undefined && n > domain.max) return `Must be ≤ ${domain.max}`
  return undefined
}

/**
 * Parses user text into a literal of `type`, checking the type range and the catalog domain
 * (`allowed`, `min`, `max`). Never rounds or truncates: anything not exactly representable is an error.
 */
export function parseTypedInput(
  raw: string,
  type: SvScalarType,
  domain?: SvValueDomain
): SvTypedParseResult {
  let value: SvScalarValue
  if (type === 'string') {
    value = raw
  } else {
    const text = raw.trim()
    if (text === '') return { ok: false, error: 'A value is required' }
    if (type === 'boolean') {
      if (text !== 'true' && text !== 'false') return { ok: false, error: 'Enter true or false' }
      value = text === 'true'
    } else if (type === 'float' || type === 'double') {
      const n = Number(text)
      if (!Number.isFinite(n)) return { ok: false, error: `Enter a number (${type})` }
      if (type === 'float' && Math.abs(n) > FLOAT32_MAX) {
        return { ok: false, error: 'Out of range for float' }
      }
      value = n
    } else {
      if (!INTEGER.test(text)) return { ok: false, error: `Enter a whole number (${type})` }
      const n = BigInt(text)
      const [lo, hi] = INT_RANGE[type] as readonly [bigint, bigint]
      if (n < lo || n > hi) return { ok: false, error: `Out of range for ${type} (${lo} … ${hi})` }
      value = is64BitType(type) ? n.toString() : Number(n)
    }
  }
  const domainError = checkDomain(value, domain)
  return domainError ? { ok: false, error: domainError } : { ok: true, value }
}

/** Maps a chosen `allowed` entry (always a string in a select) back to its typed catalog value. */
export function allowedValueOf(
  allowed: readonly SvScalarValue[],
  selected: string
): SvScalarValue | undefined {
  return allowed.find((a) => String(a) === selected)
}
