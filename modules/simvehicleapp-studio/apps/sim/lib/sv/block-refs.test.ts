import { describe, expect, it } from 'vitest'
import { blockRefs } from '@/lib/sv/block-refs'

describe('block references (ADR-0055)', () => {
  it('lists the block outputs a block reads, once, in order', () => {
    expect(
      blockRefs({
        condition: '<speedchanged.value> > 120 && <limit.result> < <speedchanged.value>',
        message: 'Speed <speedchanged.value> km/h',
      })
    ).toEqual([
      { block: 'speedchanged', text: 'speedchanged.value' },
      { block: 'limit', text: 'limit.result' },
    ])
  })

  it('signals and loop/parallel/variable references are not block outputs', () => {
    expect(
      blockRefs({ expr: '<Vehicle.Speed> > <variable.limit> + <loop.index> + <parallel.item>' })
    ).toEqual([])
  })

  it('reads table cells and nested values; ignores non-strings', () => {
    expect(
      blockRefs({
        inputs: [
          { id: 'r', cells: { value: '<a.b>' } },
          { id: 's', cells: { value: '<c.d.e>' } },
        ],
        threshold: 120,
        retain: false,
        missing: undefined,
      })
    ).toEqual([
      { block: 'a', text: 'a.b' },
      { block: 'c', text: 'c.d.e' },
    ])
  })

  it('comparison operators next to references are not mistaken for references', () => {
    expect(blockRefs({ condition: 'x<y && <a.b>>3' })).toEqual([{ block: 'a', text: 'a.b' }])
  })
})
