/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sampleText, sampleValue, usedBy } from '@/lib/sv/earlier-data'

const block = (id: string, name: string, values: Record<string, unknown> = {}) => ({
  id,
  name,
  subBlocks: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value }])),
})

describe('data from earlier blocks (M18-T08)', () => {
  it('Used by: the blocks that refer to this block, each with its references', () => {
    const blocks = {
      t: block('t', 'Speed changed'),
      i: block('i', 'If fast', {
        condition: '<speedchanged.value> > 120 && <speedchanged.previous> <= 120',
      }),
      h: block('h', 'Alert', { message: 'Speed <speedchanged.value> at <Vehicle.Speed>' }),
      o: block('o', 'Other', { condition: '<other.value> > 1' }),
    }
    expect(usedBy(blocks, 't')).toEqual([
      { id: 'h', name: 'Alert', refs: ['speedchanged.value'] },
      { id: 'i', name: 'If fast', refs: ['speedchanged.value', 'speedchanged.previous'] },
    ])
    expect(usedBy(blocks, 'i')).toEqual([])
    expect(usedBy(blocks, 'missing')).toEqual([])
  })

  it('a sample value comes from the last time the trigger ran', () => {
    const trace = [
      { ev: 'trigger', blockId: 't', data: { outputs: { value: 100, timestamp: 1000 } } },
      { ev: 'enter', blockId: 'i' },
      {
        ev: 'trigger',
        blockId: 't',
        data: { outputs: { value: 130, timestamp: 2000, meta: { n: 2 } } },
      },
    ]
    expect(sampleValue(trace, 't', 'value')).toBe(130)
    expect(sampleValue(trace, 't', 'meta.n')).toBe(2)
    expect(sampleValue(trace, 't', 'nope.deeper')).toBeUndefined()
    expect(sampleValue(trace, 'i', 'value')).toBeUndefined()
    expect(sampleText('ACTIVE')).toBe('"ACTIVE"')
    expect(sampleText(130)).toBe('130')
    expect(sampleText('x'.repeat(40))).toHaveLength(24)
  })
})
