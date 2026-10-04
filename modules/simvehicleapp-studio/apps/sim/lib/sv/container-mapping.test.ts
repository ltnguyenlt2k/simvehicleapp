/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  mapSimContainer,
  SV_REPEAT_MAX,
  SV_SUPPORTED_CONTAINER_MODES,
} from '@/lib/sv/container-mapping'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'

const specs = (
  specsSnapshot as { blocks: { type: string; container?: boolean; props: { name: string }[] }[] }
).blocks

describe('Sim containers → SV container BlockSpecs (M03-T10)', () => {
  it('maps for/while loops and count parallels', () => {
    expect(mapSimContainer({ type: 'loop', loopType: 'for', iterations: 5 })).toEqual({
      type: 'sv_repeat',
      props: { count: 5, intervalMs: 0 },
    })
    expect(
      mapSimContainer({
        type: 'loop',
        loopType: 'while',
        whileCondition: ' <Vehicle.Speed> > 0 ',
        iterations: 50,
      })
    ).toEqual({
      type: 'sv_while',
      props: { condition: '<Vehicle.Speed> > 0', maxIterations: 50, intervalMs: 0 },
    })
    expect(mapSimContainer({ type: 'parallel', parallelType: 'count', count: 3 })).toEqual({
      type: 'sv_parallel',
      props: { join: 'all' },
    })
  })

  it('while without a usable iteration cap gets the BlockSpec default (loop guard is mandatory)', () => {
    const r = mapSimContainer({ type: 'loop', loopType: 'while', whileCondition: 'true' })
    expect(r).toMatchObject({ type: 'sv_while', props: { maxIterations: 1000 } })
  })

  it.each([
    [{ type: 'loop', loopType: 'forEach' }, 'unsupported_mode'],
    [{ type: 'loop', loopType: 'doWhile', doWhileCondition: 'x' }, 'unsupported_mode'],
    [{ type: 'parallel', parallelType: 'collection' }, 'unsupported_mode'],
    [{ type: 'loop', loopType: 'while', whileCondition: '  ' }, 'missing_condition'],
    [{ type: 'loop', loopType: 'for', iterations: 0 }, 'bad_count'],
    [{ type: 'loop', loopType: 'for', iterations: SV_REPEAT_MAX + 1 }, 'bad_count'],
    [{ type: 'loop', loopType: 'for', iterations: 2.5 }, 'bad_count'],
  ] as const)('%j → CONTAINER_INVALID/%s', (container, reason) => {
    expect(mapSimContainer(container as Parameters<typeof mapSimContainer>[0])).toMatchObject({
      code: 'CONTAINER_INVALID',
      reason,
    })
  })

  it('every container BlockSpec has a Sim container mode and all spec props are produced', () => {
    const produced = {
      sv_repeat: mapSimContainer({ type: 'loop', loopType: 'for', iterations: 1 }),
      sv_while: mapSimContainer({ type: 'loop', loopType: 'while', whileCondition: 'true' }),
      sv_parallel: mapSimContainer({ type: 'parallel' }),
    }
    const containers = specs.filter((s) => s.container)
    expect(containers.map((s) => s.type).sort()).toEqual(Object.keys(produced).sort())
    for (const spec of containers) {
      const r = produced[spec.type as keyof typeof produced]
      expect('props' in r).toBe(true)
      if ('props' in r)
        expect(Object.keys(r.props).sort()).toEqual(spec.props.map((p) => p.name).sort())
    }
    expect(SV_SUPPORTED_CONTAINER_MODES).toEqual({ loop: ['for', 'while'], parallel: ['count'] })
  })
})
