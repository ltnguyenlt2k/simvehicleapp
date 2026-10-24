'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/emcn'
import { type SvMessage, svMessageSchema } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'

/** The last messages kept on screen. */
const MAX_MESSAGES = 200

interface Hmi {
  title?: string
  severity?: string
  message?: string
}

/** An HMI notification: JSON on `<prefix>/hmi` with a title, severity and message (sv_hmi_notify). */
export function hmiOf(m: SvMessage): Hmi | null {
  if (!/\/hmi$/.test(m.topic)) return null
  try {
    const v = JSON.parse(m.payload) as unknown
    if (v && typeof v === 'object' && ('title' in v || 'message' in v)) return v as Hmi
  } catch {
    // not JSON: shown as a plain message
  }
  return null
}

const SEVERITY_TONE: Record<string, string> = {
  error: 'text-[var(--text-error)]',
  critical: 'text-[var(--text-error)]',
  warning: 'text-[var(--warning)]',
}

/**
 * Messages (M18-T05, ADR-0058 §6): what the app publishes on MQTT under its topic prefix while it runs — HMI
 * notifications as cards (title, severity, message), other publishes as topic and payload.
 */
export function MessagesPanel() {
  const { project, active } = useWorkflowRuns()
  const [messages, setMessages] = useState<SvMessage[]>([])
  const projectId = project?.id

  useEffect(() => {
    if (!projectId) return
    const source = new EventSource(`/api/sv/projects/${encodeURIComponent(projectId)}/messages`)
    source.addEventListener('message', (e) => {
      const v = svMessageSchema.safeParse(JSON.parse((e as MessageEvent<string>).data))
      if (v.success) setMessages((prev) => [...prev, v.data].slice(-MAX_MESSAGES))
    })
    return () => source.close()
  }, [projectId])

  if (!project) {
    return (
      <p className='px-3 py-2 text-[var(--text-muted)] text-caption'>
        Press SynCode to create the vehicle app, then Run it to see its messages
      </p>
    )
  }
  return (
    <div data-sv='messages' className='flex min-h-0 flex-1 flex-col'>
      <div className='flex shrink-0 items-center gap-2 px-2 py-1'>
        <span className='text-[var(--text-muted)] text-caption'>
          MQTT {project.settings.mqttTopicPrefix}/#
          {active ? '' : ' — Run the app to see what it publishes'}
        </span>
        <Button
          size='sm'
          variant='ghost'
          className='ml-auto'
          disabled={!messages.length}
          onClick={() => setMessages([])}
        >
          Clear
        </Button>
      </div>
      <ul className='min-h-0 flex-1 overflow-y-auto px-2' aria-label='Messages'>
        {messages.map((m, i) => {
          const hmi = hmiOf(m)
          return (
            <li
              key={`${m.ts}-${i}`}
              data-sv-message={hmi ? 'hmi' : 'publish'}
              className='border-[var(--border)] border-b py-1 text-caption'
            >
              <span className='mr-2 text-[var(--text-muted)] tabular-nums'>
                {new Date(m.ts).toLocaleTimeString()}
              </span>
              {hmi ? (
                <span>
                  <span
                    className={cn(
                      'font-medium',
                      SEVERITY_TONE[hmi.severity ?? ''] ?? 'text-[var(--text-primary)]'
                    )}
                  >
                    {hmi.title ?? 'HMI'}
                  </span>
                  {hmi.severity && (
                    <span className='ml-1 text-[var(--text-muted)]'>({hmi.severity})</span>
                  )}
                  {hmi.message && (
                    <span className='ml-2 text-[var(--text-secondary)]'>{hmi.message}</span>
                  )}
                </span>
              ) : (
                <span className='font-mono'>
                  <span className='text-[var(--text-secondary)]'>{m.topic}</span>{' '}
                  <span className='text-[var(--text-primary)]'>{m.payload}</span>
                </span>
              )}
            </li>
          )
        })}
        {!messages.length && (
          <li className='py-2 text-[var(--text-muted)] text-caption'>No message yet</li>
        )}
      </ul>
    </div>
  )
}
