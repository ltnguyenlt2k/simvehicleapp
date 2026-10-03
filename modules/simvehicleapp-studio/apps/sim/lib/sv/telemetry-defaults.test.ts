/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import telemetryConfig from '@/telemetry.config'

describe('telemetry defaults (M01-T07)', () => {
  it('has no upstream collector and is disabled without an operator endpoint', () => {
    expect(telemetryConfig.endpoint).toBe('')
    expect(JSON.stringify(telemetryConfig)).not.toContain('simstudio.ai')
    expect(telemetryConfig.serverSide.enabled).toBe(false)
    expect(telemetryConfig.clientSide.enabled).toBe(false)
  })
})
