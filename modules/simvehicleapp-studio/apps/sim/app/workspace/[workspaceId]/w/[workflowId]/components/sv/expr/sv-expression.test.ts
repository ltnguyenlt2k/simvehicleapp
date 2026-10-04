/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/sv-catalog', () => ({}))
vi.mock('@/hooks/kb/use-tag-selection', () => ({}))
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown',
  () => ({})
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value',
  () => ({})
)
vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release',
  () => ({})
)

import {
  insertAt,
  svxLiteral,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/expr/sv-expression'

describe('sv-expression helpers', () => {
  it('inserts at the caret and clamps out-of-range positions', () => {
    expect(insertAt('a > 1', 0, '<Vehicle.Speed> ')).toEqual({
      value: '<Vehicle.Speed> a > 1',
      cursor: 16,
    })
    expect(insertAt('x', 99, '!')).toEqual({ value: 'x!', cursor: 2 })
    expect(insertAt('x', -5, '!')).toEqual({ value: '!x', cursor: 1 })
  })

  it('turns catalog values into SVX literals', () => {
    expect(svxLiteral('RAIN_SENSOR')).toBe('"RAIN_SENSOR"')
    expect(svxLiteral('a "q"')).toBe('"a \\"q\\""')
    expect(svxLiteral(4)).toBe('4')
    expect(svxLiteral(true)).toBe('true')
  })
})
