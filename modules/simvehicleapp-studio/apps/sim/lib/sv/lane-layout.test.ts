/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANE, type LaneBlock, laneLayout, laneRegions } from '@/lib/sv/lane-layout'

const GOLDEN = join(__dirname, '__golden__')
const golden = (id: string) =>
  (
    JSON.parse(readFileSync(join(GOLDEN, id, 'sim-state.json'), 'utf8')) as {
      state: {
        blocks: Record<string, LaneBlock>
        edges: { source: string; sourceHandle?: string; target: string }[]
      }
    }
  ).state

const b = (id: string, type: string, x = 0, y = 0): LaneBlock => ({
  id,
  type,
  name: id,
  position: { x, y },
})

describe('lanes (M18-T08, ADR-0059 §3)', () => {
  it('one lane per trigger; then straight on, else on a row below; a join after both branches', () => {
    const blocks = {
      t1: b('t1', 'sv_on_signal_changed'),
      i: b('i', 'sv_if'),
      on: b('on', 'sv_set_actuator'),
      off: b('off', 'sv_set_actuator'),
      log: b('log', 'sv_log'),
      t2: b('t2', 'sv_on_timer', 0, 500),
      pub: b('pub', 'sv_mqtt_publish'),
    }
    const edges = [
      { source: 't1', target: 'i' },
      { source: 'i', sourceHandle: 'else', target: 'off' },
      { source: 'i', sourceHandle: 'then', target: 'on' },
      { source: 'on', target: 'log' },
      { source: 'off', target: 'log' },
      { source: 't2', target: 'pub' },
    ]
    const p = laneLayout(blocks, edges)
    const col = (id: string) => (p[id].x - LANE.ORIGIN_X) / LANE.COLUMN
    expect([col('t1'), col('i'), col('on'), col('off'), col('log')]).toEqual([0, 1, 2, 2, 3])
    expect(p.on.y).toBe(p.t1.y) // then: straight on
    expect(p.off.y).toBeGreaterThan(p.on.y) // else: below
    expect(p.t2.y).toBeGreaterThan(p.off.y) // the second lane below the first
    expect(p.t2.y - p.off.y).toBe(LANE.ROW + LANE.GAP)
    expect(laneLayout(structuredClone(blocks), edges)).toEqual(p)
  })

  it('every golden lays out without overlapping blocks, the same every time', () => {
    for (const id of ['GW-A', 'GW-B', 'GW-C', 'GW-D', 'GW-E', 'GW-F', 'GW-G']) {
      const s = golden(id)
      const p = laneLayout(s.blocks, s.edges)
      expect(laneLayout(s.blocks, s.edges)).toEqual(p)
      const spots = Object.values(p).map((q) => `${q.x},${q.y}`)
      expect(new Set(spots).size).toBe(spots.length)
      // Children of a container keep their place.
      for (const blk of Object.values(s.blocks))
        if (blk.data?.parentId) expect(p[blk.id]).toBeUndefined()
    }
  })

  it('a cycle does not loop forever; unreached blocks get their own row', () => {
    const p = laneLayout(
      { t: b('t', 'sv_on_app_start'), w: b('w', 'sv_wait'), x: b('x', 'sv_log', 0, 900) },
      [
        { source: 't', target: 'w' },
        { source: 'w', target: 'w' },
      ]
    )
    expect(Object.keys(p).sort()).toEqual(['t', 'w', 'x'])
    expect(p.x.y).toBeGreaterThan(p.t.y)
  })

  it('regions: one per trigger after a lane layout, none when two overlap', () => {
    const blocks = {
      t1: b('t1', 'sv_on_app_start'),
      a: b('a', 'sv_log'),
      t2: b('t2', 'sv_on_timer', 0, 1),
      c: b('c', 'sv_log'),
    }
    const edges = [
      { source: 't1', target: 'a' },
      { source: 't2', target: 'c' },
    ]
    const p = laneLayout(blocks, edges)
    const placed = Object.fromEntries(
      Object.entries(blocks).map(([id, blk]) => [id, { ...blk, position: p[id] }])
    )
    const regions = laneRegions(placed, edges)
    expect(regions.map((r) => r.name)).toEqual(['t1', 't2'])
    expect(laneRegions(blocks, edges)).toEqual([])
  })
})
