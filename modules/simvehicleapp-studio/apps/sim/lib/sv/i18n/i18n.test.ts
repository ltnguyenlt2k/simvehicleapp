/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseSvLocale, svPlural, svTranslate } from '@/lib/sv/i18n'
import { EN } from '@/lib/sv/i18n/messages/en'
import { VI } from '@/lib/sv/i18n/messages/vi'
import { svPhraseVi } from '@/lib/sv/i18n/phrase'
import { SV_PHRASES_VI } from '@/lib/sv/i18n/phrases-vi'

describe('UI language (ADR-0072)', () => {
  it('Vietnamese has exactly the English keys, with the same placeholders', () => {
    expect(Object.keys(VI).sort()).toEqual(Object.keys(EN).sort())
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(EN) as (keyof typeof EN)[]) {
      expect(holes(VI[key]), key).toEqual(holes(EN[key]))
    }
  })

  it('translates with variables, plurals and an English fallback', () => {
    expect(svTranslate('vi', 'robot.toast.deployed', { robot: 'dog1' })).toBe(
      'Đã triển khai lên dog1; chưa chạy'
    )
    expect(
      svPlural((k, v) => svTranslate('en', k, v), 2, 'common.errors.one', 'common.errors.other')
    ).toBe('2 errors')
    expect(parseSvLocale('vi')).toBe('vi')
    expect(parseSvLocale('fr')).toBe('en')
  })

  it('phrase table: exact phrases, templates keep their variable parts, unknown text stays', () => {
    expect(svPhraseVi('Problems')).toBe('Vấn đề')
    expect(svPhraseVi('  Problems  ')).toBe('  Vấn đề  ')
    expect(svPhraseVi('Delete Hazard app')).toBe('Xoá Hazard app')
    expect(svPhraseVi('Deployed · bench · read-only')).toBe('Đã triển khai · bench · read-only')
    expect(svPhraseVi('default-agent')).toBeNull()
    for (const [en, vi] of Object.entries(SV_PHRASES_VI)) {
      const holes = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].length
      expect(holes(vi), en).toBeLessThanOrEqual(holes(en))
    }
  })
})
