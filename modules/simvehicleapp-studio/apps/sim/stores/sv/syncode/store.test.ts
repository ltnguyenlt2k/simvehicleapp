import { beforeEach, describe, expect, it } from 'vitest'
import type { SvLogLine } from '@/lib/api/contracts/sv'
import { SV_BUILD_LOG_LIMIT, useSvSynCodeStore } from '@/stores/sv/syncode/store'

const line = (seq: number, runId = 'g1'): SvLogLine => ({
  runId,
  seq,
  ts: seq,
  stream: 'stdout',
  level: 'info',
  msg: `line ${seq}`,
})

describe('useSvSynCodeStore', () => {
  beforeEach(() => useSvSynCodeStore.getState().clear())

  it('starts a generation with an empty log and focuses the Build log', () => {
    const s = useSvSynCodeStore.getState()
    s.start('p1', 'g1')
    s.append('g1', [line(0)])
    s.start('p1', 'g2')
    const now = useSvSynCodeStore.getState()
    expect(now).toMatchObject({ projectId: 'p1', generationId: 'g2', lines: [] })
    expect(now.focusBuildLog).toBe(2)
  })

  it('keeps lines in order and ignores lines replayed after a reconnect', () => {
    const s = useSvSynCodeStore.getState()
    s.start('p1', 'g1')
    s.append('g1', [line(0), line(1)])
    s.append('g1', [line(1), line(2)])
    expect(useSvSynCodeStore.getState().lines.map((l) => l.seq)).toEqual([0, 1, 2])
  })

  it('drops lines of another generation', () => {
    const s = useSvSynCodeStore.getState()
    s.start('p1', 'g2')
    s.append('g1', [line(0)])
    expect(useSvSynCodeStore.getState().lines).toEqual([])
  })

  it('keeps the most recent lines within the limit', () => {
    const s = useSvSynCodeStore.getState()
    s.start('p1', 'g1')
    s.append(
      'g1',
      Array.from({ length: SV_BUILD_LOG_LIMIT + 10 }, (_, i) => line(i))
    )
    const { lines } = useSvSynCodeStore.getState()
    expect(lines).toHaveLength(SV_BUILD_LOG_LIMIT)
    expect(lines[0].seq).toBe(10)
  })
})
