'use client'

import { Sparkles } from 'lucide-react'
import { cn } from '@/lib/core/utils/cn'
import {
  elapsedLabel,
  SLOW_TURN_MS,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/assistant/assistant-steps'
import { useNow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-now'

const DOT_DELAYS = [
  '[animation-delay:0ms]',
  '[animation-delay:150ms]',
  '[animation-delay:300ms]',
] as const

interface AssistantThinkingProps {
  /** When the turn started (the user's message, or the confirmation of an action). */
  startedAt: number
  provider: string
  model: string
}

/**
 * The assistant is working on a turn (M17-T06): a pulsing assistant icon, "Thinking…" with three moving dots and the
 * time waited; after 30 s it says the model is slow and which one answers. Animations stop with reduced motion.
 * The model's internal reasoning is never shown: only the tools it calls (as steps) and its answer.
 */
export function AssistantThinking({ startedAt, provider, model }: AssistantThinkingProps) {
  const now = useNow(1000)
  const elapsed = now - startedAt
  return (
    <div
      role='status'
      aria-live='polite'
      data-sv-assistant='thinking'
      className='flex flex-col gap-1 py-1 text-small'
    >
      <div className='flex items-center gap-2'>
        <span className='relative flex size-[20px] items-center justify-center'>
          <span
            aria-hidden
            className='absolute inset-0 animate-ring-pulse rounded-full bg-[var(--surface-5)] motion-reduce:animate-none'
          />
          <Sparkles aria-hidden className='relative size-[14px] text-[var(--text-icon)]' />
        </span>
        <span className='animate-thinking-block text-[var(--text-secondary)] motion-reduce:animate-none'>
          Thinking
        </span>
        <span aria-hidden className='flex gap-0.5'>
          {DOT_DELAYS.map((delay) => (
            <span
              key={delay}
              className={cn(
                'size-[4px] animate-bounce rounded-full bg-[var(--text-muted)] motion-reduce:animate-none',
                delay
              )}
            />
          ))}
        </span>
        <span className='text-[var(--text-muted)] text-caption' data-sv-assistant='elapsed'>
          {elapsedLabel(elapsed)}
        </span>
      </div>
      {elapsed >= SLOW_TURN_MS && (
        <div className='pl-7 text-[var(--text-muted)] text-caption' data-sv-assistant='slow'>
          The model is answering slowly ({provider} · {model}). You can wait or press Stop.
        </div>
      )}
    </div>
  )
}
