/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  allowedValueOf,
  formatTypedValue,
  parseTypedInput,
  SV_SCALAR_TYPES,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/typed-value'

describe('parseTypedInput (M02-T08, ADR-0018)', () => {
  it('covers all 12 VSS scalar types', () => {
    expect(SV_SCALAR_TYPES).toHaveLength(12)
  })

  it('parses booleans strictly', () => {
    expect(parseTypedInput('true', 'boolean')).toEqual({ ok: true, value: true })
    expect(parseTypedInput(' false ', 'boolean')).toEqual({ ok: true, value: false })
    expect(parseTypedInput('1', 'boolean')).toEqual({ ok: false, error: 'Enter true or false' })
  })

  it.each([
    ['int8', '-128', -128],
    ['int8', '127', 127],
    ['uint8', '255', 255],
    ['int16', '-32768', -32768],
    ['uint16', '65535', 65535],
    ['int32', '-2147483648', -2147483648],
    ['uint32', '4294967295', 4294967295],
  ] as const)('%s accepts its bound %s', (type, raw, value) => {
    expect(parseTypedInput(raw, type)).toEqual({ ok: true, value })
  })

  it.each([
    ['int8', '128'],
    ['uint8', '-1'],
    ['uint8', '256'],
    ['uint16', '65536'],
    ['int32', '2147483648'],
    ['uint32', '4294967296'],
    ['int64', '9223372036854775808'],
    ['uint64', '18446744073709551616'],
  ] as const)('%s rejects out-of-range %s', (type, raw) => {
    const r = parseTypedInput(raw, type)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.error).toContain(`Out of range for ${type}`)
  })

  it('rejects fractions, exponents and junk for integers instead of rounding', () => {
    for (const raw of ['1.5', '1e3', '0x10', '', '007', '12abc']) {
      expect(parseTypedInput(raw, 'uint16').ok).toBe(false)
    }
  })

  it('keeps int64/uint64 as exact decimal strings (no Number precision loss)', () => {
    expect(parseTypedInput('9223372036854775000', 'int64')).toEqual({
      ok: true,
      value: '9223372036854775000',
    })
    expect(parseTypedInput('-9223372036854775808', 'int64')).toEqual({
      ok: true,
      value: '-9223372036854775808',
    })
    expect(parseTypedInput('18446744073709551615', 'uint64')).toEqual({
      ok: true,
      value: '18446744073709551615',
    })
  })

  it('parses float/double and rejects non-finite or float32 overflow', () => {
    expect(parseTypedInput('80.5', 'float')).toEqual({ ok: true, value: 80.5 })
    expect(parseTypedInput('-1e300', 'double')).toEqual({ ok: true, value: -1e300 })
    expect(parseTypedInput('1e39', 'float')).toEqual({ ok: false, error: 'Out of range for float' })
    expect(parseTypedInput('NaN', 'double').ok).toBe(false)
    expect(parseTypedInput('Infinity', 'double').ok).toBe(false)
  })

  it('keeps strings verbatim, including spaces and empty text', () => {
    expect(parseTypedInput('  hello ', 'string')).toEqual({ ok: true, value: '  hello ' })
    expect(parseTypedInput('', 'string')).toEqual({ ok: true, value: '' })
  })

  it('applies the catalog min/max (Window.Position 0…100 percent)', () => {
    const domain = { min: 0, max: 100 }
    expect(parseTypedInput('100', 'uint8', domain)).toEqual({ ok: true, value: 100 })
    expect(parseTypedInput('101', 'uint8', domain)).toEqual({ ok: false, error: 'Must be ≤ 100' })
    expect(parseTypedInput('-0.5', 'float', domain)).toEqual({ ok: false, error: 'Must be ≥ 0' })
  })

  it('applies the catalog allowed list (Wiping.Mode)', () => {
    const domain = { allowed: ['OFF', 'SLOW', 'RAIN_SENSOR'] }
    expect(parseTypedInput('RAIN_SENSOR', 'string', domain)).toEqual({
      ok: true,
      value: 'RAIN_SENSOR',
    })
    expect(parseTypedInput('rain', 'string', domain)).toEqual({
      ok: false,
      error: 'Must be one of: OFF, SLOW, RAIN_SENSOR',
    })
  })
})

describe('helpers', () => {
  it('maps a selected label back to the typed allowed value', () => {
    expect(allowedValueOf([1, 2, 3], '2')).toBe(2)
    expect(allowedValueOf([true, false], 'false')).toBe(false)
    expect(allowedValueOf(['A'], 'B')).toBeUndefined()
  })

  it('formats stored values for the input', () => {
    expect(formatTypedValue(null)).toBe('')
    expect(formatTypedValue(undefined)).toBe('')
    expect(formatTypedValue(false)).toBe('false')
    expect(formatTypedValue('9223372036854775000')).toBe('9223372036854775000')
  })
})
