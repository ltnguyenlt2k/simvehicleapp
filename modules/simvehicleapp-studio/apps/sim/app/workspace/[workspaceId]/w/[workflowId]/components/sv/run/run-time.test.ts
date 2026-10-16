/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canExtendSoon,
  RUN_EXPIRY_WARN_MS,
  runChoices,
  timeLeftLabel,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/run-time'

describe('run time limit (ADR-0057)', () => {
  it('labels the time left in minutes, then seconds; nothing without a limit', () => {
    expect(timeLeftLabel(undefined, 0)).toBeNull()
    expect(timeLeftLabel(30 * 60_000, 0)).toBe('30 min')
    expect(timeLeftLabel(61_000, 0)).toBe('2 min')
    expect(timeLeftLabel(45_000, 0)).toBe('45 s')
    expect(timeLeftLabel(0, 5_000)).toBe('0 s')
  })

  it('offers Extend in the last 5 minutes of a running app, while extensions remain', () => {
    const run = { state: 'running', expiresAt: RUN_EXPIRY_WARN_MS, extensions: 0 }
    expect(canExtendSoon(run, 3, 0)).toBe(true)
    expect(canExtendSoon(run, 3, -1)).toBe(false)
    expect(canExtendSoon({ ...run, extensions: 3 }, 3, 0)).toBe(false)
    expect(canExtendSoon({ ...run, state: 'starting' }, 3, 0)).toBe(false)
    expect(canExtendSoon({ state: 'running' }, 3, 0)).toBe(false)
  })

  it('asks when other apps run; side by side only with sandboxes under the quota', () => {
    expect(runChoices(0, { sandbox: false, perUser: 1 })).toEqual({ ask: false, parallel: true })
    expect(runChoices(1, { sandbox: false, perUser: 1 })).toEqual({ ask: true, parallel: false })
    expect(runChoices(1, { sandbox: true, perUser: 2 })).toEqual({ ask: true, parallel: true })
    expect(runChoices(2, { sandbox: true, perUser: 2 })).toEqual({ ask: true, parallel: false })
  })
})
