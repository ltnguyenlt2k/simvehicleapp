/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { svAllowsCycle } from '@/stores/workflows/workflow/utils'

describe('svAllowsCycle (ADR-0067 robot back-edges)', () => {
  const blocks = {
    repeat: { type: 'rf_repeat' },
    goTo: { type: 'rf_go_to' },
    vehicle: { type: 'sv_wait' },
    agent: { type: 'agent' },
  }

  it('allows a back-edge between two robot blocks only', () => {
    expect(svAllowsCycle(blocks, 'goTo', 'repeat')).toBe(true)
    expect(svAllowsCycle(blocks, 'vehicle', 'repeat')).toBe(false)
    expect(svAllowsCycle(blocks, 'goTo', 'agent')).toBe(false)
    expect(svAllowsCycle(blocks, 'missing', 'repeat')).toBe(false)
  })

  it('never allows a self-loop', () => {
    expect(svAllowsCycle(blocks, 'repeat', 'repeat')).toBe(false)
  })
})
