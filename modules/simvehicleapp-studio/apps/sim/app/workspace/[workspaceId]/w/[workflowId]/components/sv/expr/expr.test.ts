/**
 * @vitest-environment node
 */
import Prism from 'prismjs'
import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  parseDuration,
  SV_DURATION_MAX_MS,
  splitDuration,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/expr/duration'
import { SVX_GRAMMAR } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/expr/svx-grammar'

describe('parseDuration (M03-T08)', () => {
  it.each([
    ['500', 'ms', 500],
    ['2', 's', 2000],
    ['1.5', 's', 1500],
    ['1.1', 's', 1100],
    ['0.25', 'min', 15000],
    ['0', 'ms', 0],
  ] as const)('%s %s = %i ms (exact, no float drift)', (raw, unit, ms) => {
    expect(parseDuration(raw, unit)).toEqual({ ok: true, ms })
  })

  it('rejects sub-millisecond, negative, junk and too long values', () => {
    expect(parseDuration('0.5', 'ms')).toEqual({
      ok: false,
      error: 'Must be a whole number of milliseconds',
    })
    expect(parseDuration('-1', 's').ok).toBe(false)
    expect(parseDuration('1e3', 'ms').ok).toBe(false)
    expect(parseDuration('', 'ms').ok).toBe(false)
    expect(parseDuration(String(SV_DURATION_MAX_MS + 1), 'ms').ok).toBe(false)
    expect(parseDuration('9999999', 'min').ok).toBe(false)
  })

  it('applies the BlockSpec minimum (timer interval ≥ 10 ms)', () => {
    expect(parseDuration('5', 'ms', 10)).toEqual({ ok: false, error: 'Must be at least 10 ms' })
    expect(parseDuration('10', 'ms', 10)).toEqual({ ok: true, ms: 10 })
  })

  it('shows a stored value in the largest exact unit', () => {
    expect(splitDuration(2000)).toEqual({ value: '2', unit: 's' })
    expect(splitDuration(1500)).toEqual({ value: '1500', unit: 'ms' })
    expect(splitDuration(120000)).toEqual({ value: '2', unit: 'min' })
    expect(splitDuration(0)).toEqual({ value: '0', unit: 'ms' })
    expect(formatDuration(500)).toBe('500 ms')
  })
})

describe('SVX highlighting grammar', () => {
  const tokens = (src: string) =>
    Prism.tokenize(src, SVX_GRAMMAR)
      .filter((t): t is Prism.Token => typeof t !== 'string')
      .map((t) => [t.type, String(t.content)])

  it('keeps references, numbers with units and strings as single tokens', () => {
    expect(tokens('<Vehicle.Speed> > 120 km/h && <variable.warn> == "on"')).toEqual([
      ['variable', '<Vehicle.Speed>'],
      ['operator', '>'],
      ['number', '120 km/h'],
      ['operator', '&&'],
      ['variable', '<variable.warn>'],
      ['operator', '=='],
      ['string', '"on"'],
    ])
  })

  it('marks whitelisted functions and booleans', () => {
    expect(tokens('clamp(1, 0, true)')).toEqual([
      ['function', 'clamp'],
      ['punctuation', '('],
      ['number', '1'],
      ['punctuation', ','],
      ['number', '0'],
      ['punctuation', ','],
      ['boolean', 'true'],
      ['punctuation', ')'],
    ])
    expect(tokens('foo(1)').map(([t]) => t)).not.toContain('function')
  })
})
