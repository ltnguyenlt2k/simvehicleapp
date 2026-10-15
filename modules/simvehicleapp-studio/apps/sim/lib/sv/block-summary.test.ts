import { describe, expect, it } from 'vitest'
import {
  blockSummary,
  duration,
  readable,
  SV_SUMMARY_RULES,
  shortPath,
} from '@/lib/sv/block-summary'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

const SPECS = (specsSnapshot as { blocks: { type: string; category: string }[] }).blocks
const table = (column: string, ...values: string[]) =>
  values.map((value, i) => ({ id: `r${i}`, cells: { [column]: value } }))

describe('block summary (ADR-0055)', () => {
  it('has a rule for every BlockSpec, and none for blocks that do not exist', () => {
    expect(Object.keys(SV_SUMMARY_RULES).sort()).toEqual(SPECS.map((s) => s.type).sort())
  })

  it('every rule gives a sentence for an empty block (being filled in)', () => {
    for (const s of SPECS) {
      const summary = blockSummary(s.type, {})
      expect(summary?.text.length, s.type).toBeGreaterThan(0)
      expect(summary?.text.length, s.type).toBeLessThanOrEqual(64)
    }
  })

  it('the role follows the category', () => {
    const role: Record<string, string[]> = {
      triggers: ['when'],
      flow: ['if', 'flow'],
      actuators: ['do'],
      comm: ['send'],
      sensors: ['read'],
      attributes: ['read'],
      composite: ['read'],
      logic: ['calc'],
      state: ['state'],
    }
    for (const s of SPECS)
      expect(role[s.category], s.type).toContain(blockSummary(s.type, {})?.role)
  })

  it.each([
    ['sv_on_signal_changed', { path: 'Vehicle.Speed', mode: 'any' }, 'When Speed changes'],
    [
      'sv_on_signal_changed',
      { path: 'Vehicle.Speed', mode: 'crosses_above', threshold: 110, debounceMs: 500 },
      'When Speed goes above 110 (settled 500 ms)',
    ],
    [
      'sv_on_condition',
      { expr: '<Vehicle.Body.Raindetection.Intensity> > 30' },
      'When Raindetection.Intensity > 30 becomes true',
    ],
    ['sv_on_timer', { intervalMs: 1000, initialDelayMs: 0 }, 'Every 1 s'],
    ['sv_on_timer', { intervalMs: 120000, initialDelayMs: 1500 }, 'Every 2 min, first after 1.5 s'],
    [
      'sv_stable_for',
      { condition: '<speedchanged.value> > 120', durationMs: 2000 },
      'If speedchanged.value > 120 holds for 2 s',
    ],
    [
      'sv_wait_until',
      { condition: '<a.b> == 0', timeoutMs: 10000 },
      'Wait until a.b == 0 (max 10 s)',
    ],
    [
      'sv_set_actuator',
      { path: 'Vehicle.Body.Lights.Hazard.IsSignaling', value: 'true', awaitAck: true },
      'Set Hazard.IsSignaling = true, wait for it',
    ],
    ['sv_hmi_notify', { severity: 'warning', title: 'Overspeed' }, '⚠ HMI: Overspeed'],
    ['sv_math', { op: 'abs', a: '<x.value>' }, 'abs(x.value)'],
    ['sv_math', { op: 'max', a: '1', b: '2' }, 'max(1, 2)'],
    [
      'sv_bool',
      { op: 'and', inputs: table('value', '<a.b>', '<Vehicle.IsMoving>') },
      'a.b and IsMoving',
    ],
    ['sv_bool', { op: 'not', inputs: table('value', '<a.b>') }, 'not a.b'],
    [
      'sv_switch',
      { value: '<m.result>', cases: table('when', '1', '2') },
      'Switch on m.result · 2 cases',
    ],
    ['sv_counter', { name: 'n', op: 'dec', step: 2 }, 'n −= 2'],
    ['sv_counter', { name: 'n', op: 'reset' }, 'Reset n'],
    [
      'sv_filter',
      { value: '<s.value>', mode: 'exponential', alpha: 0.3 },
      'Smooth s.value (α 0.3)',
    ],
    ['sv_parallel', { join: 'any' }, 'Run in parallel, continue when one finishes'],
    ['sv_stop', { scope: 'app' }, 'Stop the app'],
    ['sv_read_signal', { path: 'Vehicle.Speed', source: 'fresh-read' }, 'Read Speed (fresh)'],
  ])('%s %j → %s', (type, values, text) => {
    expect(blockSummary(type, values)?.text).toBe(text)
  })

  it('is not drawn for blocks that are not vehicle blocks', () => {
    expect(blockSummary('agent', {})).toBeNull()
  })

  it('shortens long sentences and expressions', () => {
    const long = blockSummary('sv_if', { condition: `<a.b> > ${'1'.repeat(80)}` })?.text ?? ''
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long.endsWith('…')).toBe(true)
    expect(readable('<Vehicle.Cabin.Door.Row1.DriverSide.IsOpen>')).toBe('DriverSide.IsOpen')
  })

  it('helpers', () => {
    expect(shortPath('Vehicle.Speed')).toBe('Speed')
    expect(shortPath(undefined)).toBe('…')
    expect(duration(500)).toBe('500 ms')
    expect(duration('2000')).toBe('2 s')
    expect(duration(undefined)).toBe('…')
  })
})
