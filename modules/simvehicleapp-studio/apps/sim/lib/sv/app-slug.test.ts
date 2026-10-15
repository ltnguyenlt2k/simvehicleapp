import { describe, expect, it } from 'vitest'
import { appSlugOf, appSlugWithSuffix, freeAppSlug, SV_APP_SLUG } from '@/lib/sv/app-slug'

describe('vehicle app folder names', () => {
  it('derives a valid folder name from the name', () => {
    expect(appSlugOf('My Vehicle App')).toBe('my-vehicle-app')
    expect(appSlugOf('  Đèn cảnh báo!! ')).toBe('den-canh-bao')
    expect(SV_APP_SLUG.test(appSlugOf('x'.repeat(100)))).toBe(true)
  })

  it('avoids the folder names already used and never returns an invalid one', () => {
    expect(freeAppSlug('Hazard App', [])).toBe('hazard-app')
    expect(freeAppSlug('Hazard App', ['hazard-app', 'hazard-app-2'])).toBe('hazard-app-3')
    expect(freeAppSlug('!!!', [])).toBe('vehicle-app')
    const long = freeAppSlug('a'.repeat(80), ['a'.repeat(63)])
    expect(long).toHaveLength(63)
    expect(SV_APP_SLUG.test(long)).toBe(true)
  })

  it('adds a short suffix for a name another workspace uses', () => {
    expect(appSlugWithSuffix('hazard-app', 'K3_x9Zq')).toBe('hazard-app-k3x9zq')
    expect(SV_APP_SLUG.test(appSlugWithSuffix('b'.repeat(63), 'abcdef'))).toBe(true)
  })
})
