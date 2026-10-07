import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  SvAiConversation,
  SvAiEvent,
  SvAiPendingAction,
  SvAiProposal,
} from '@/lib/api/contracts/sv-ai'

export interface SvAiToolCall {
  id: string
  name: string
  isError?: boolean
}

export type SvAiItem =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'assistant'; key: string; text: string; tools: SvAiToolCall[] }
  | {
      kind: 'proposal'
      key: string
      proposal: SvAiProposal
      state: 'new' | 'previewed' | 'dismissed'
    }
  | {
      kind: 'action'
      key: string
      action: SvAiPendingAction
      state: 'pending' | 'confirmed' | 'cancelled'
    }
  | { kind: 'error'; key: string; text: string }

interface SvAssistantState {
  /** Workflow the conversation is about; switching workflows starts over. */
  workflowId: string | null
  conversationId: string | null
  items: SvAiItem[]
  streaming: boolean
  seq: number
  open: (workflowId: string) => void
  newConversation: () => void
  /** A turn starts: the user's message (none when confirming/cancelling an action). */
  startTurn: (text?: string) => void
  apply: (event: SvAiEvent) => void
  endTurn: (error?: string) => void
  markProposal: (key: string, state: 'previewed' | 'dismissed') => void
  markAction: (actionId: string, state: 'confirmed' | 'cancelled') => void
  /** A conversation reloaded from the server (messages and the pending action). */
  load: (conversation: SvAiConversation) => void
  reset: () => void
}

const initialState = {
  workflowId: null as string | null,
  conversationId: null as string | null,
  items: [] as SvAiItem[],
  streaming: false,
  seq: 0,
}

/** Adds to the assistant message being streamed, or starts one. */
function lastAssistant(
  items: SvAiItem[],
  key: string
): [SvAiItem[], SvAiItem & { kind: 'assistant' }] {
  const last = items[items.length - 1]
  if (last?.kind === 'assistant') return [items.slice(0, -1), { ...last, tools: [...last.tools] }]
  return [items, { kind: 'assistant', key, text: '', tools: [] }]
}

/** Assistant panel of the open workflow (M10-T08, ADR-0030): one conversation at a time. */
export const useSvAssistantStore = create<SvAssistantState>()(
  devtools(
    (set) => ({
      ...initialState,
      open: (workflowId) =>
        set((s) => (s.workflowId === workflowId ? s : { ...initialState, workflowId, seq: s.seq })),
      newConversation: () => set((s) => (s.streaming ? s : { conversationId: null, items: [] })),
      startTurn: (text) =>
        set((s) => ({
          streaming: true,
          seq: s.seq + 1,
          items: text ? [...s.items, { kind: 'user', key: `u${s.seq + 1}`, text }] : s.items,
        })),
      apply: (event) =>
        set((s) => {
          const key = `i${s.seq + 1}`
          switch (event.event) {
            case 'text': {
              if (!event.data.delta) return s
              const [rest, msg] = lastAssistant(s.items, key)
              return {
                seq: s.seq + 1,
                items: [...rest, { ...msg, text: msg.text + event.data.delta }],
              }
            }
            case 'tool': {
              const [rest, msg] = lastAssistant(s.items, key)
              msg.tools.push({ id: event.data.id, name: event.data.name })
              return { seq: s.seq + 1, items: [...rest, msg] }
            }
            case 'tool_result':
              return {
                items: s.items.map((it) =>
                  it.kind === 'assistant' && it.tools.some((t) => t.id === event.data.id)
                    ? {
                        ...it,
                        tools: it.tools.map((t) =>
                          t.id === event.data.id ? { ...t, isError: event.data.isError } : t
                        ),
                      }
                    : it
                ),
              }
            case 'proposal':
              return {
                seq: s.seq + 1,
                items: [
                  // An older proposal not looked at yet is superseded by the new one.
                  ...s.items.map((it) =>
                    it.kind === 'proposal' && it.state === 'new'
                      ? { ...it, state: 'dismissed' as const }
                      : it
                  ),
                  { kind: 'proposal', key, proposal: event.data, state: 'new' },
                ],
              }
            case 'pending_action':
              return {
                seq: s.seq + 1,
                items: [...s.items, { kind: 'action', key, action: event.data, state: 'pending' }],
              }
            case 'error':
              return {
                seq: s.seq + 1,
                items: [...s.items, { kind: 'error', key, text: event.data.message }],
              }
            case 'done':
              return { conversationId: event.data.conversationId, streaming: false }
          }
        }),
      endTurn: (error) =>
        set((s) => ({
          streaming: false,
          seq: s.seq + 1,
          items: error
            ? [...s.items, { kind: 'error', key: `e${s.seq + 1}`, text: error }]
            : s.items,
        })),
      markProposal: (key, state) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.kind === 'proposal' && it.key === key ? { ...it, state } : it
          ),
        })),
      markAction: (actionId, state) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.kind === 'action' && it.action.actionId === actionId ? { ...it, state } : it
          ),
        })),
      load: (conversation) =>
        set((s) => {
          const items: SvAiItem[] = conversation.messages.map((m, i) =>
            m.role === 'user'
              ? { kind: 'user', key: `h${i}`, text: m.text }
              : {
                  kind: 'assistant',
                  key: `h${i}`,
                  text: m.text,
                  tools: (m.tools ?? []).map((t, j) => ({ id: `h${i}-${j}`, name: t.name })),
                }
          )
          if (conversation.pending) {
            items.push({
              kind: 'action',
              key: 'h-pending',
              action: conversation.pending,
              state: 'pending',
            })
          }
          return { conversationId: conversation.id, items, streaming: false, seq: s.seq + 1 }
        }),
      reset: () => set(initialState),
    }),
    { name: 'sv-assistant-store' }
  )
)
