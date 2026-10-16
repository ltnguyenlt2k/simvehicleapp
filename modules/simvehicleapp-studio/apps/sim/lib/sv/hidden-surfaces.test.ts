/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isHiddenApiRoute, isHiddenSurface } from '@/lib/sv/hidden-surfaces'

describe('Sim executor surfaces (ADR-0056)', () => {
  it('hides the workflow chat and run from/until block', () => {
    expect(isHiddenSurface('workflow-chat')).toBe(true)
    expect(isHiddenSurface('run-from-block')).toBe(true)
    expect(isHiddenSurface('run-until-block')).toBe(true)
  })

  it.each([
    '/api/workflows/wf1/execute',
    '/api/workflows/wf1/execute/stream',
    '/api/workflows/wf1/chat',
    '/api/workflows/wf1/chat/status',
  ])('%s answers 404', (path) => {
    expect(isHiddenApiRoute(path)).toBe(true)
  })

  it.each([
    '/api/workflows/wf1',
    '/api/workflows/wf1/state',
    '/api/workflows/wf1/variables',
    '/api/workflows/wf1/duplicate',
    '/api/workflows/wf1/autolayout',
    '/api/sv/projects/p1/runs',
    '/api/sv/simulate',
    '/api/workflows/executions',
  ])('%s stays available', (path) => {
    expect(isHiddenApiRoute(path)).toBe(false)
  })
})
