/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { parseSvAiBlock, readSvAiEvents } from '@/lib/sv/ai-stream'
import { useSvAssistantStore } from '@/stores/sv/assistant/store'

const proposal = {
  patch: { patchVersion: '1.0.0', ops: [] },
  graph: { graphVersion: '1.0.0', workflowId: 'wf', blocks: [], edges: [] },
  diagnostics: [],
  summary: {
    added: [{ id: 'b2', type: 'sv_log', name: 'Log' }],
    changed: [],
    removed: [],
    edgesAdded: 1,
  },
  valid: true,
}

describe('assistant store (M10-T08)', () => {
  beforeEach(() => useSvAssistantStore.getState().reset())

  it('streams a turn: text deltas join, tools attach to the message, the proposal and done land', () => {
    const s = useSvAssistantStore.getState()
    s.open('wf')
    s.startTurn('Add a log')
    s.apply({ event: 'text', data: { delta: 'Look' } })
    s.apply({ event: 'tool', data: { id: 't1', name: 'vss_search', input: {} } })
    s.apply({
      event: 'tool_result',
      data: { id: 't1', name: 'vss_search', isError: true, text: 'x' },
    })
    s.apply({ event: 'text', data: { delta: 'ing.' } })
    s.apply({ event: 'proposal', data: proposal })
    s.apply({ event: 'done', data: { conversationId: 'c_1', pending: false, steps: 2 } })
    const { items, streaming, conversationId } = useSvAssistantStore.getState()
    expect(streaming).toBe(false)
    expect(conversationId).toBe('c_1')
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'proposal'])
    expect(items[1]).toMatchObject({
      text: 'Looking.',
      tools: [{ name: 'vss_search', isError: true }],
    })
  })

  it('a newer proposal supersedes an unseen one; actions are marked by id; switching workflow starts over', () => {
    const s = useSvAssistantStore.getState()
    s.open('wf')
    s.startTurn('x')
    s.apply({ event: 'proposal', data: proposal })
    s.apply({ event: 'proposal', data: proposal })
    s.apply({
      event: 'pending_action',
      data: { actionId: 'a1', toolName: 'run_start', toolInput: { projectId: 'p' }, expiresAt: 1 },
    })
    s.markAction('a1', 'confirmed')
    const items = useSvAssistantStore.getState().items
    expect(
      items.filter((i) => i.kind === 'proposal').map((i) => i.kind === 'proposal' && i.state)
    ).toEqual(['dismissed', 'new'])
    expect(items.at(-1)).toMatchObject({ kind: 'action', state: 'confirmed' })
    s.open('other')
    expect(useSvAssistantStore.getState()).toMatchObject({
      workflowId: 'other',
      items: [],
      conversationId: null,
    })
  })

  it('reloads a conversation with its pending action', () => {
    useSvAssistantStore.getState().load({
      id: 'c_2',
      messages: [
        { role: 'user', text: 'Run it' },
        { role: 'assistant', text: '', tools: [{ name: 'run_start' }] },
      ],
      pending: { actionId: 'a2', toolName: 'run_start', toolInput: {}, expiresAt: 5 },
    })
    expect(useSvAssistantStore.getState().items.map((i) => i.kind)).toEqual([
      'user',
      'assistant',
      'action',
    ])
  })
})

describe('assistant SSE reader', () => {
  it('parses blocks split across chunks and skips malformed ones', async () => {
    const chunks = [
      'event: text\ndata: {"delta":"He',
      'llo"}\n\nevent: bogus\ndata: {}\n\nevent: text\ndata: not json\n\n',
      'event: done\ndata: {"conversationId":"c","pending":false,"steps":1}\n\n',
    ]
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x))
        c.close()
      },
    })
    const seen: string[] = []
    await readSvAiEvents(body, (e) =>
      seen.push(e.event === 'text' ? `text:${e.data.delta}` : e.event)
    )
    expect(seen).toEqual(['text:Hello', 'done'])
    expect(parseSvAiBlock(': keep-alive')).toBeNull()
  })
})
