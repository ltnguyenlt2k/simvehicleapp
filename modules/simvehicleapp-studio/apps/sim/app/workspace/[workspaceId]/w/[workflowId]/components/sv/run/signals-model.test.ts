/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applySignalUpdates,
  graphSignalPaths,
  parseSignalInput,
  recordingToScenario,
  signalInputOf,
  triggerHints,
  typedValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-model'

describe('signals panel model (M08-T08/T09)', () => {
  it('watches the signals the workflow uses', () => {
    const graph = JSON.stringify({
      blocks: [
        { props: { path: 'Vehicle.Speed' } },
        { props: { path: 'Vehicle.Body.Lights.Hazard.IsSignaling' } },
        { props: { path: 'Vehicle.Speed' } },
        { props: { durationMs: 2000 } },
      ],
    })
    expect(graphSignalPaths(graph)).toEqual([
      'Vehicle.Body.Lights.Hazard.IsSignaling',
      'Vehicle.Speed',
    ])
    expect(graphSignalPaths('{bad')).toEqual([])
  })

  it('also watches the signals read in expressions and templates (M18-T05)', () => {
    const graph = JSON.stringify({
      blocks: [
        {
          props: {
            condition: '<Vehicle.Speed> > 10 && <Vehicle.ADAS.LaneDepartureDetection.IsWarning>',
          },
        },
        {
          props: {
            message: 'Speed {<Vehicle.Speed>} km/h',
            rows: [{ text: '<Vehicle.Cabin.Door.Row1.DriverSide.IsOpen>' }],
          },
        },
        { props: { condition: '<speedchanged.value> > 1' } },
      ],
    })
    expect(graphSignalPaths(graph)).toEqual([
      'Vehicle.ADAS.LaneDepartureDetection.IsWarning',
      'Vehicle.Cabin.Door.Row1.DriverSide.IsOpen',
      'Vehicle.Speed',
    ])
  })

  it('reads typed input like the scenario editor', () => {
    expect(parseSignalInput('true')).toBe(true)
    expect(parseSignalInput(' 130 ')).toBe(130)
    expect(parseSignalInput('[1, 2]')).toEqual([1, 2])
    expect(parseSignalInput('SLOW')).toBe('SLOW')
    expect(parseSignalInput('')).toBe('')
  })

  it('keeps the latest value and target of each signal', () => {
    let v = applySignalUpdates({}, [{ path: 'A', ts: 1, value: 1, field: 'value' }])
    v = applySignalUpdates(v, [{ path: 'A', ts: 2, value: true, field: 'target' }])
    expect(v.A).toEqual({ value: 1, target: true, ts: 2 })
  })

  it('a recording becomes a scenario v1 with the initial values and timed inputs', () => {
    expect(
      recordingToScenario(
        {
          startedAt: 0,
          initial: { 'Vehicle.Speed': 0 },
          inputs: [
            { t: 1200.4, path: 'Vehicle.Speed', value: 100 },
            { t: 3500, path: 'Vehicle.Speed', value: 130 },
          ],
        },
        'Recorded'
      )
    ).toEqual({
      scenarioVersion: '1.0.0',
      name: 'Recorded',
      until: 6000,
      initial: { 'Vehicle.Speed': 0 },
      inputs: [
        { t: 1200, path: 'Vehicle.Speed', value: 100 },
        { t: 3500, path: 'Vehicle.Speed', value: 130 },
      ],
    })
  })
})

describe('typed inject and hints (M18-T05, ADR-0058 §6)', () => {
  const node = (o: object) => ({ path: 'Vehicle.X', name: 'X', ...o }) as never
  it('sensors take a value; actuators a request (target) first, feedback (current) second', () => {
    expect(signalInputOf(node({ kind: 'sensor', datatype: 'float' })).fields).toEqual(['value'])
    expect(signalInputOf(node({ kind: 'actuator', datatype: 'boolean' }))).toEqual({
      fields: ['target', 'value'],
      defaultField: 'target',
      control: { kind: 'bool' },
    })
    expect(signalInputOf(undefined).fields).toEqual(['value', 'target'])
  })
  it('enum, number with unit and range, text', () => {
    expect(
      signalInputOf(node({ kind: 'actuator', datatype: 'string', allowed: ['OFF', 'SLOW'] }))
        .control
    ).toEqual({ kind: 'enum', options: ['OFF', 'SLOW'] })
    expect(
      signalInputOf(node({ kind: 'sensor', datatype: 'uint8', unit: 'percent', min: 0, max: 100 }))
        .control
    ).toEqual({ kind: 'number', unit: 'percent', min: 0, max: 100, integer: true })
    expect(signalInputOf(node({ kind: 'sensor', datatype: 'string' })).control).toEqual({
      kind: 'text',
    })
  })
  it('typed values are checked before they are sent', () => {
    const pct = { kind: 'number' as const, min: 0, max: 100, integer: true }
    expect(typedValue(pct, '42')).toEqual({ ok: true, value: 42 })
    expect(typedValue(pct, '101')).toEqual({ ok: false, error: 'at most 100' })
    expect(typedValue(pct, '1.5')).toEqual({ ok: false, error: 'a whole number' })
    expect(typedValue({ kind: 'bool' }, 'false')).toEqual({ ok: true, value: false })
    expect(typedValue({ kind: 'enum', options: ['OFF'] }, 'ON')).toEqual({
      ok: false,
      error: 'one of OFF',
    })
  })
  it('trigger hints say which change fires the workflow', () => {
    const graph = JSON.stringify({
      blocks: [
        { type: 'sv_on_signal_changed', props: { path: 'Vehicle.A', mode: 'rising' } },
        {
          type: 'sv_on_signal_changed',
          props: { path: 'Vehicle.Speed', mode: 'crosses_below', threshold: 110 },
        },
      ],
    })
    expect([...triggerHints(graph)]).toEqual([
      ['Vehicle.A', 'trigger: rises (false → true)'],
      ['Vehicle.Speed', 'trigger: crosses below 110'],
    ])
  })
})

describe('Record proposes expectations (M18-T05, ADR-0058 §7)', () => {
  it('what the app wrote while recording becomes expected writes within 300 ms (scenario 1.1)', () => {
    const s = recordingToScenario(
      {
        startedAt: 0,
        initial: { 'Vehicle.Speed': 100 },
        inputs: [{ t: 1000, path: 'Vehicle.Speed', value: 130 }],
        observed: [{ t: 3210, path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: true }],
      },
      'Recorded'
    )
    expect(s.scenarioVersion).toBe('1.1.0')
    expect(s.expect).toEqual({
      writes: [
        { t: 2910, path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: true, within: 300 },
      ],
    })
    expect(s.until).toBe(6000)
  })
})
