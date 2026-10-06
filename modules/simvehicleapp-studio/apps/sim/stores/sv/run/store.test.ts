import { beforeEach, describe, expect, it } from 'vitest'
import type { SvTraceEvent } from '@/lib/api/contracts/sv'
import { reduceLiveBlock, SV_RUN_CONSOLE_LIMIT, useSvRunStore } from '@/stores/sv/run/store'

const trace = (seq: number, ev: string, extra: Partial<SvTraceEvent> = {}) => ({
  event: 'trace' as const,
  data: { runId: 'r1', seq, ts: seq, wf: 'wf1', run: 1, node: 'n2', blockId: 'b2', ev, ...extra },
})
const log = (seq: number, msg = `line ${seq}`) => ({
  event: 'log' as const,
  data: { runId: 'r1', seq, ts: seq, stream: 'stdout' as const, level: 'info' as const, msg },
})

describe('live run store (M08-T08)', () => {
  beforeEach(() => useSvRunStore.getState().clear())

  it('keeps log and trace entries in seq order, ignoring replays and other runs', () => {
    const s = useSvRunStore.getState()
    s.follow('p1', 'r1')
    s.ingest('r1', [log(0), trace(1, 'enter')])
    s.ingest('r1', [trace(1, 'enter'), log(2)])
    s.ingest('r2', [log(3)])
    const { entries, lastSeq, focusRunConsole } = useSvRunStore.getState()
    expect(entries.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(lastSeq).toBe(2)
    expect(focusRunConsole).toBe(1)
  })

  it('tracks what each block of each workflow is doing', () => {
    const s = useSvRunStore.getState()
    s.follow('p1', 'r1')
    s.ingest('r1', [
      trace(0, 'enter'),
      trace(1, 'write', { blockId: 'b3', node: 'n3', data: { value: true } }),
    ])
    expect(useSvRunStore.getState().blocks.wf1).toMatchObject({
      b2: { state: 'running', open: 1, runs: 0 },
      b3: { last: 'true' },
    })
    s.ingest('r1', [trace(2, 'exit')])
    expect(useSvRunStore.getState().blocks.wf1.b2).toMatchObject({
      state: 'done',
      open: 0,
      runs: 1,
    })
  })

  it('a sampled event counts for the events it stands for', () => {
    let b = reduceLiveBlock(undefined, trace(0, 'enter', { data: { dropped: 9 } }).data)
    expect(b).toMatchObject({ open: 10, state: 'running' })
    b = reduceLiveBlock(b, trace(1, 'exit', { data: { dropped: 9 } }).data)
    expect(b).toMatchObject({ open: 0, runs: 10, state: 'done' })
    b = reduceLiveBlock(b, trace(2, 'error').data)
    expect(b.state).toBe('error')
  })

  it('a new run starts empty; the console keeps the newest entries', () => {
    const s = useSvRunStore.getState()
    s.follow('p1', 'r1')
    s.ingest(
      'r1',
      Array.from({ length: SV_RUN_CONSOLE_LIMIT + 5 }, (_, i) => log(i))
    )
    expect(useSvRunStore.getState().entries).toHaveLength(SV_RUN_CONSOLE_LIMIT)
    expect(useSvRunStore.getState().entries[0].seq).toBe(5)
    s.follow('p1', 'r2')
    expect(useSvRunStore.getState()).toMatchObject({
      runId: 'r2',
      entries: [],
      lastSeq: -1,
      blocks: {},
    })
  })
})
