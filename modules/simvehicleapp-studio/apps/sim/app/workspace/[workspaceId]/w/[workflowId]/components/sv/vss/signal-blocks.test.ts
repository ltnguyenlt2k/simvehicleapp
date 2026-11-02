/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  parseSignalPayload,
  rssCondition,
  signalBlockChoices,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/signal-blocks'

const types = (signal: Parameters<typeof signalBlockChoices>[0]) =>
  signalBlockChoices(signal).map((c) => c.type)

describe('signalBlockChoices (ADR-0010 §6, M02-T10)', () => {
  it('sensor → Read, When changes (never Set)', () => {
    const choices = signalBlockChoices({ kind: 'sensor', name: 'Speed', datatype: 'float' })
    expect(choices.map((c) => [c.label, c.blockName])).toEqual([
      ['Read', 'Read Speed'],
      ['When changes', 'When Speed changes'],
    ])
  })

  it('actuator → Read, When changes, Set; array actuator → no Set (ADR-0018 §2)', () => {
    expect(types({ kind: 'actuator', name: 'IsSignaling', datatype: 'boolean' })).toEqual([
      'sv_read_signal',
      'sv_on_signal_changed',
      'sv_set_actuator',
    ])
    expect(
      signalBlockChoices({ kind: 'actuator', name: 'IsSignaling', datatype: 'boolean' })[2]
        ?.blockName
    ).toBe('Set IsSignaling')
    expect(types({ kind: 'actuator', name: 'X', datatype: 'string[]' })).not.toContain(
      'sv_set_actuator'
    )
  })

  it('attribute → Read attribute named after the attribute; branch → nothing', () => {
    const path = 'Vehicle.VehicleIdentification.VIN'
    expect(
      signalBlockChoices({ kind: 'attribute', name: 'VIN', datatype: 'string', path })
    ).toEqual([
      { type: 'sv_read_attribute', label: 'Read attribute', blockName: 'VIN', preset: { path } },
    ])
    expect(signalBlockChoices({ kind: 'branch', name: 'Cabin' })).toEqual([])
  })
})

describe('signalBlockChoices for RSS signals (robot workflows)', () => {
  it('offers When / If / Wait until with the condition preset by type', () => {
    const marker = signalBlockChoices({
      catalog: 'rss',
      kind: 'sensor',
      name: 'IsDetected',
      path: 'Robot.Perception.Marker.IsDetected',
      datatype: 'bool' as never,
    })
    expect(marker.map((c) => c.type)).toEqual(['rf_on_condition', 'rf_if', 'rf_wait_until'])
    expect(marker[0]?.preset).toEqual({ when: 'Robot.Perception.Marker.IsDetected == true' })
    expect(
      rssCondition({
        path: 'Robot.Safety.Mode',
        datatype: 'enum' as never,
        values: ['DISARMED', 'MANUAL'],
      })
    ).toBe("Robot.Safety.Mode == 'DISARMED'")
    expect(
      rssCondition({
        path: 'Robot.PowerSystem.Battery.StateOfCharge',
        datatype: 'float64' as never,
        unit: '%',
      })
    ).toBe('Robot.PowerSystem.Battery.StateOfCharge > 0 %')
  })
})

describe('parseSignalPayload', () => {
  it('accepts a Vehicle panel drag payload', () => {
    const signal = {
      path: 'Vehicle.Speed',
      name: 'Speed',
      kind: 'sensor',
      datatype: 'float',
      unit: 'km/h',
    }
    expect(parseSignalPayload({ type: 'sv_signal', svSignal: signal })).toEqual(signal)
  })

  it('ignores ordinary toolbar block drags and malformed payloads', () => {
    expect(parseSignalPayload({ type: 'note', enableTriggerMode: false })).toBeUndefined()
    expect(
      parseSignalPayload({ svSignal: { path: 'Vehicle.Cabin', name: 'Cabin', kind: 'branch' } })
    ).toBeUndefined()
    expect(parseSignalPayload({ svSignal: { path: 1, name: 'x', kind: 'sensor' } })).toBeUndefined()
    expect(parseSignalPayload(null)).toBeUndefined()
  })
})
