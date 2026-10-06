/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { lineDiff } from '@/lib/sv/line-diff'

const render = (before: string, after: string, max?: number) =>
  lineDiff(before, after, max).map((l) => `${{ same: ' ', add: '+', del: '-' }[l.kind]}${l.text}`)

describe('lineDiff', () => {
  it('reports identical files as unchanged', () => {
    expect(render('a\nb', 'a\nb')).toEqual([' a', ' b'])
  })

  it('aligns changed lines between a common prefix and suffix', () => {
    expect(render('a\nb\nc\nd', 'a\nB\nc\nd\ne')).toEqual([' a', '-b', '+B', ' c', ' d', '+e'])
  })

  it('keeps moved-around common lines', () => {
    expect(render('x\na\ny', 'a\nz')).toEqual(['-x', ' a', '-y', '+z'])
  })

  it('handles an empty side', () => {
    expect(render('', 'a')).toEqual(['-', '+a'])
  })

  it('falls back to remove-then-add above the size limit', () => {
    expect(render('a\nb\nc', 'a\nc\nb', 1)).toEqual([' a', '-b', '-c', '+c', '+b'])
  })
})
