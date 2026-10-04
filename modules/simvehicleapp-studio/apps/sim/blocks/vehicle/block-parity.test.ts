/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { SV_VEHICLE_BLOCKS } from '@/blocks/vehicle'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

/**
 * BlockConfig ↔ BlockSpec parity (ADR-0011 §4). `block-specs.json` is the compiler's `GET /blocks`
 * body, kept equal to core by `scripts/ci/block_specs_sync.py` (the studio may not import core).
 */
interface SpecProp {
  name: string
  kind: string
  required: boolean
  default?: unknown
  enum?: unknown[]
  valueType?: string
}
interface Spec {
  type: string
  category: string
  vssKinds?: string[]
  props: SpecProp[]
  outputs: { name: string; type: string }[]
  handles: { in: string[]; out: string[] }
}

const SPECS = (specsSnapshot as { blocks: Spec[] }).blocks

/**
 * Studio editor(s) allowed for each BlockSpec prop kind. Interim editors (until the dedicated
 * subBlock lands) are listed explicitly so they are removed on purpose, not by accident.
 */
const EDITORS: Record<string, readonly string[]> = {
  'vss-path': ['vss-path-selector'],
  enum: ['dropdown'],
  'typed-value': ['sv-typed-value', 'sv-enum'],
  /** `sv-expression` arrives in M03-T08; a typed literal is a valid expression meanwhile. */
  expression: ['sv-expression', 'sv-typed-value'],
  /** `sv-duration` arrives in M03-T08; meanwhile a uint32 in ms. */
  duration: ['sv-duration', 'sv-typed-value'],
  boolean: ['switch'],
}

/** Sim output types for BlockSpec output types: signal-typed values are `any` on the canvas. */
const OUTPUT_TYPES: Record<string, string> = {
  $signal: 'any',
  $element: 'any',
  $inferred: 'any',
  timestamp: 'number',
  boolean: 'boolean',
  string: 'string',
}

function initialValue(sub: SubBlockConfig): unknown {
  if (typeof sub.value === 'function') return sub.value({})
  return sub.defaultValue
}

/**
 * Specs whose studio BlockConfig is not written yet, with the task that adds it. Kept explicit so a
 * spec cannot silently lack UI: the M3 gate requires this list to be empty again.
 */
const PENDING_UI: Record<string, string> = Object.fromEntries(
  [
    'sv_array_at',
    'sv_array_contains',
    'sv_array_length',
    'sv_bool',
    'sv_clamp',
    'sv_compare',
    'sv_constant',
    'sv_convert',
    'sv_expression',
    'sv_in_range',
    'sv_lookup',
    'sv_math',
    'sv_on_app_start',
    'sv_on_condition',
    'sv_on_mqtt',
    'sv_on_timer',
    'sv_scale',
  ].map((type) => [type, 'M03-T07'])
)

describe('block parity: studio BlockConfig ↔ core BlockSpec (M02-T09)', () => {
  it('every spec has a BlockConfig unless listed as pending, and vice versa', () => {
    const withUi = Object.keys(SV_VEHICLE_BLOCKS).sort()
    expect(withUi.every((type) => SPECS.some((s) => s.type === type))).toBe(true)
    expect(withUi.filter((type) => type in PENDING_UI)).toEqual([])
    expect(SPECS.map((s) => s.type).filter((type) => !withUi.includes(type))).toEqual(
      Object.keys(PENDING_UI).sort()
    )
  })

  describe.each(
    SPECS.filter((s) => !(s.type in PENDING_UI)).map((s) => [s.type, s] as const)
  )('%s', (type, spec) => {
    const config = SV_VEHICLE_BLOCKS[type] as BlockConfig

    it('has the same type and canvas handles (Sim draws no in/error handle on triggers)', () => {
      expect(config.type).toBe(spec.type)
      const isTrigger = config.category === 'triggers'
      expect(isTrigger).toBe(spec.category === 'triggers')
      expect(spec.handles).toEqual(
        isTrigger ? { in: [], out: ['source'] } : { in: ['target'], out: ['source', 'error'] }
      )
    })

    it('has one subBlock per prop, in spec order', () => {
      expect(config.subBlocks.map((s) => s.id)).toEqual(spec.props.map((p) => p.name))
    })

    it.each(spec.props.map((p) => [p.name, p] as const))('prop %s matches', (_name, prop) => {
      const sub = config.subBlocks.find((s) => s.id === prop.name) as SubBlockConfig
      expect(EDITORS[prop.kind]).toContain(sub.type)
      expect(sub.required === true).toBe(prop.required)
      if (prop.default !== undefined) expect(initialValue(sub)).toEqual(prop.default)
      if (prop.kind === 'enum') {
        expect((sub.options as { id: string }[]).map((o) => o.id)).toEqual(prop.enum)
      }
      if (prop.kind === 'vss-path') {
        expect(sub.vssKinds).toEqual(spec.vssKinds)
        expect(sub.vssWrites === true).toBe(spec.type === 'sv_set_actuator')
      }
      if (prop.valueType) expect(sub.svValueType).toBe(prop.valueType)
      if (prop.kind === 'duration') {
        expect(sub.svValueType).toBe('uint32')
        expect(sub.svUnit).toBe('ms')
      }
    })

    it('exposes the spec outputs for <Block.field> references', () => {
      expect(Object.keys(config.outputs)).toEqual(spec.outputs.map((o) => o.name))
      for (const out of spec.outputs) {
        const def = config.outputs[out.name] as { type: string }
        expect(def.type).toBe(OUTPUT_TYPES[out.type])
      }
    })
  })
})
