'use client'

import { useEffect, useRef, useState } from 'react'
import { Badge, Button, ChipTextarea } from '@/components/emcn'
import type { SvAiPendingAction } from '@/lib/api/contracts/sv-ai'
import { cn } from '@/lib/core/utils/cn'
import { useAssistant } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/assistant/use-assistant'
import { useSvAiConversations, useSvAiStatus } from '@/hooks/queries/sv-ai'
import { type SvAiItem, useSvAssistantStore } from '@/stores/sv/assistant/store'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff'

/**
 * Assistant panel (M10-T08, ADR-0030): chat about the open workflow. The assistant only proposes
 * WorkflowPatch changes — shown on the canvas as a diff to accept or reject — and asks before any
 * action with side effects (SynCode, Run, inject…), whose input can be edited first.
 */
export function SvAssistantPanel() {
  const workflowId = useSvLintStore((s) => s.workflowId)
  const graphReady = useSvLintStore((s) => Boolean(s.graphJson))
  const items = useSvAssistantStore((s) => s.items)
  const streaming = useSvAssistantStore((s) => s.streaming)
  const conversationId = useSvAssistantStore((s) => s.conversationId)
  const { data: status, isLoading } = useSvAiStatus()
  const { data: conversations } = useSvAiConversations(workflowId ?? undefined)
  const { send, decide, stop, preview, openConversation } = useAssistant()
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (workflowId) useSvAssistantStore.getState().open(workflowId)
  }, [workflowId])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [items])

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming || !graphReady) return
    setDraft('')
    void send(text)
  }

  if (isLoading) return null
  if (!status?.configured) {
    return (
      <div
        className='flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center'
        data-sv-assistant='not-configured'
      >
        <div className='font-medium text-[var(--text-primary)] text-sm'>Assistant</div>
        <div className='text-[var(--text-muted)] text-small'>
          {status?.reason ?? 'No AI provider is configured.'} Set SV_AI_PROVIDER and SV_AI_MODEL
          (and the provider's key) in .env, then restart the ai-assistant service.
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full min-h-0 flex-col' data-sv-assistant='panel'>
      <div className='flex items-center gap-2 px-3 pb-2'>
        <Badge variant='outline' size='sm' title='LLM used by the assistant'>
          {status.provider} · {status.model}
        </Badge>
        <div className='flex-1' />
        <Button
          variant='ghost'
          size='sm'
          data-sv-assistant='new'
          disabled={streaming || (!conversationId && !items.length)}
          onClick={() => useSvAssistantStore.getState().newConversation()}
        >
          New chat
        </Button>
      </div>

      <div
        ref={listRef}
        className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3'
        data-sv-assistant='messages'
      >
        {!items.length && (
          <div className='flex flex-col gap-2 py-4 text-[var(--text-muted)] text-small'>
            <div>
              Describe what the vehicle app should do — e.g. “Turn on the hazard lights when the
              speed stays above 120 km/h for 2 seconds”. Proposals appear on the canvas for you to
              accept or reject.
            </div>
            {conversations?.length ? (
              <div className='flex flex-col gap-1 pt-2'>
                <div className='text-[var(--text-secondary)]'>Earlier conversations</div>
                {conversations.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    type='button'
                    className='truncate text-left text-[var(--text-secondary)] hover-hover:text-[var(--text-primary)]'
                    data-sv-ai-conversation={c.id}
                    onClick={() => void openConversation(c.id)}
                  >
                    {c.title || c.id}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {items.map((item) => (
          <AssistantItem
            key={item.key}
            item={item}
            streaming={streaming}
            onPreview={preview}
            onDecide={decide}
          />
        ))}
        {streaming && (
          <div className='text-[var(--text-muted)] text-small' data-sv-assistant='thinking'>
            Working…
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2 p-3'>
        <ChipTextarea
          aria-label='Message the assistant'
          data-sv-assistant='input'
          rows={3}
          value={draft}
          placeholder={graphReady ? 'Ask for a change to this workflow…' : 'Loading the workflow…'}
          disabled={!graphReady}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <div className='flex justify-end gap-2'>
          {streaming ? (
            <Button variant='ghost' size='sm' data-sv-assistant='stop' onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button
              variant='primary'
              size='sm'
              data-sv-assistant='send'
              disabled={!draft.trim() || !graphReady}
              onClick={submit}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

interface AssistantItemProps {
  item: SvAiItem
  streaming: boolean
  onPreview: (item: SvAiItem & { kind: 'proposal' }) => void
  onDecide: (
    action: SvAiPendingAction,
    decision: 'confirm' | 'cancel',
    editedInput?: Record<string, unknown>
  ) => void
}

function AssistantItem({ item, streaming, onPreview, onDecide }: AssistantItemProps) {
  switch (item.kind) {
    case 'user':
      return (
        <div
          className='self-end whitespace-pre-wrap rounded-md bg-[var(--surface-5)] px-2 py-1.5 text-[var(--text-primary)] text-small'
          data-sv-ai-message='user'
        >
          {item.text}
        </div>
      )
    case 'assistant':
      return (
        <div className='flex flex-col gap-1' data-sv-ai-message='assistant'>
          {item.tools.length > 0 && (
            <div className='flex flex-wrap gap-1'>
              {item.tools.map((t) => (
                <Badge
                  key={t.id}
                  variant={t.isError ? 'red' : 'outline'}
                  size='sm'
                  data-sv-ai-tool={t.name}
                >
                  {t.name}
                </Badge>
              ))}
            </div>
          )}
          {item.text && (
            <div className='whitespace-pre-wrap text-[var(--text-primary)] text-small'>
              {item.text}
            </div>
          )}
        </div>
      )
    case 'proposal':
      return <ProposalCard item={item} streaming={streaming} onPreview={onPreview} />
    case 'action':
      return <ActionCard item={item} streaming={streaming} onDecide={onDecide} />
    case 'error':
      return (
        <div className='text-[var(--text-error)] text-small' data-sv-ai-message='error'>
          {item.text}
        </div>
      )
  }
}

interface ProposalCardProps {
  item: SvAiItem & { kind: 'proposal' }
  streaming: boolean
  onPreview: AssistantItemProps['onPreview']
}

function ProposalCard({ item, streaming, onPreview }: ProposalCardProps) {
  const hasActiveDiff = useWorkflowDiffStore((s) => s.hasActiveDiff)
  const { summary, diagnostics, valid } = item.proposal
  const errors = diagnostics.filter((d) => d.severity === 'error')
  const warnings = diagnostics.filter((d) => d.severity === 'warning')
  return (
    <div
      className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] p-2 text-small'
      data-sv-ai-proposal={item.state}
      data-sv-ai-valid={valid}
    >
      <div className='font-medium text-[var(--text-primary)]'>Proposed change</div>
      <ul className='flex flex-col gap-0.5 text-[var(--text-secondary)]'>
        {summary.added.map((b) => (
          <li key={`a-${b.id}`}>
            + {b.name} <span className='text-[var(--text-muted)]'>({b.type})</span>
          </li>
        ))}
        {summary.changed.map((b) => (
          <li key={`c-${b.id}`}>~ {b.name}</li>
        ))}
        {summary.removed.map((b) => (
          <li key={`r-${b.id}`}>− {b.name}</li>
        ))}
        {summary.edgesAdded > 0 && <li>{summary.edgesAdded} new connection(s)</li>}
      </ul>
      {[...errors, ...warnings].slice(0, 5).map((d, i) => (
        <div
          key={`${d.code}-${i}`}
          className={cn(
            'text-small',
            d.severity === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
          )}
          data-sv-ai-diagnostic={d.code}
        >
          {d.code}: {d.message}
        </div>
      ))}
      {item.state === 'new' && (
        <div className='flex justify-end'>
          <Button
            variant={valid ? 'primary' : 'ghost'}
            size='sm'
            data-sv-ai-preview
            disabled={streaming || hasActiveDiff}
            title={hasActiveDiff ? 'Accept or reject the changes on the canvas first' : undefined}
            onClick={() => onPreview(item)}
          >
            {valid ? 'Show on canvas' : 'Show on canvas (has errors)'}
          </Button>
        </div>
      )}
      {item.state === 'previewed' && (
        <div className='text-[var(--text-muted)]'>On the canvas — Accept or Reject it there.</div>
      )}
      {item.state === 'dismissed' && <div className='text-[var(--text-muted)]'>Superseded.</div>}
    </div>
  )
}

interface ActionCardProps {
  item: SvAiItem & { kind: 'action' }
  streaming: boolean
  onDecide: AssistantItemProps['onDecide']
}

function ActionCard({ item, streaming, onDecide }: ActionCardProps) {
  const original = JSON.stringify(item.action.toolInput, null, 2)
  const [input, setInput] = useState(original)
  let parsed: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(input) as unknown
    parsed = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    parsed = null
  }
  const pending = item.state === 'pending'
  return (
    <div
      className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] p-2 text-small'
      data-sv-ai-action={item.action.toolName}
      data-sv-ai-action-state={item.state}
    >
      <div className='font-medium text-[var(--text-primary)]'>Confirm: {item.action.toolName}</div>
      {item.action.description && (
        <div className='text-[var(--text-secondary)]'>{item.action.description}</div>
      )}
      <ChipTextarea
        aria-label={`Input of ${item.action.toolName}`}
        rows={Math.min(8, original.split('\n').length)}
        value={input}
        error={parsed === null}
        disabled={!pending}
        onChange={(e) => setInput(e.target.value)}
      />
      {pending ? (
        <div className='flex justify-end gap-2'>
          <Button
            variant='ghost'
            size='sm'
            data-sv-ai-cancel
            disabled={streaming}
            onClick={() => onDecide(item.action, 'cancel')}
          >
            Cancel
          </Button>
          <Button
            variant='primary'
            size='sm'
            data-sv-ai-confirm
            disabled={streaming || parsed === null}
            onClick={() =>
              parsed && onDecide(item.action, 'confirm', input === original ? undefined : parsed)
            }
          >
            Confirm
          </Button>
        </div>
      ) : (
        <div className='text-[var(--text-muted)]'>
          {item.state === 'confirmed' ? 'Confirmed.' : 'Cancelled.'}
        </div>
      )}
    </div>
  )
}
