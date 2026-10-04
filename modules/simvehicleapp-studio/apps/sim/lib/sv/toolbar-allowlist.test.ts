/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TOOLBAR_ALLOWLIST,
  getToolbarAllowlist,
  isToolbarBlockAllowed,
  parseToolbarAllowlist,
} from '@/lib/sv/toolbar-allowlist'
import { getAllBlocks } from '@/blocks/registry'
import { SV_VEHICLE_BLOCKS } from '@/blocks/vehicle'

vi.unmock('@/blocks/registry')

afterEach(() => {
  Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST')
})

describe('toolbar allowlist (M01-T05)', () => {
  it('defaults to sv_*, note and the loop/parallel containers (M03-T10)', () => {
    expect(DEFAULT_TOOLBAR_ALLOWLIST).toBe('sv_*,note,loop,parallel')
    const patterns = getToolbarAllowlist()
    for (const type of ['sv_read_signal', 'note', 'loop', 'parallel']) {
      expect(isToolbarBlockAllowed(type, patterns)).toBe(true)
    }
    for (const type of ['agent', 'api', 'slack', 'starter', 'notes', 'xsv_x', 'loops']) {
      expect(isToolbarBlockAllowed(type, patterns)).toBe(false)
    }
  })

  it('hides every registered Sim block except note; every SimVehicleApp sv_* block stays', () => {
    const offered = getAllBlocks()
      .map((block) => block.type)
      .filter((type) => isToolbarBlockAllowed(type))
    expect(offered.filter((type) => !type.startsWith('sv_'))).toEqual(['note'])
    expect(offered.filter((type) => type.startsWith('sv_')).sort()).toEqual(
      Object.keys(SV_VEHICLE_BLOCKS).sort()
    )
  })

  it('honours NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST and treats regex characters literally', () => {
    process.env.NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST = ' sv_*, api ,a.b '
    expect(isToolbarBlockAllowed('api')).toBe(true)
    expect(isToolbarBlockAllowed('sv_wait')).toBe(true)
    expect(isToolbarBlockAllowed('note')).toBe(false)
    expect(isToolbarBlockAllowed('a.b')).toBe(true)
    expect(isToolbarBlockAllowed('axb')).toBe(false)
  })

  it('falls back to the default for an empty value', () => {
    expect(parseToolbarAllowlist('  ').map(String)).toEqual(
      parseToolbarAllowlist(undefined).map(String)
    )
  })
})
