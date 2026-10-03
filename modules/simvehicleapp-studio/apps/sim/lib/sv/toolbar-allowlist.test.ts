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

vi.unmock('@/blocks/registry')

afterEach(() => {
  Reflect.deleteProperty(process.env, 'NEXT_PUBLIC_SV_TOOLBAR_ALLOWLIST')
})

describe('toolbar allowlist (M01-T05)', () => {
  it('defaults to sv_* and note', () => {
    expect(DEFAULT_TOOLBAR_ALLOWLIST).toBe('sv_*,note')
    const patterns = getToolbarAllowlist()
    expect(isToolbarBlockAllowed('sv_read_signal', patterns)).toBe(true)
    expect(isToolbarBlockAllowed('note', patterns)).toBe(true)
    for (const type of ['agent', 'api', 'slack', 'loop', 'parallel', 'starter', 'notes', 'xsv_x']) {
      expect(isToolbarBlockAllowed(type, patterns)).toBe(false)
    }
  })

  it('hides every registered Sim block except note', () => {
    const offered = getAllBlocks()
      .map((block) => block.type)
      .filter((type) => isToolbarBlockAllowed(type))
    expect(offered).toEqual(['note'])
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
