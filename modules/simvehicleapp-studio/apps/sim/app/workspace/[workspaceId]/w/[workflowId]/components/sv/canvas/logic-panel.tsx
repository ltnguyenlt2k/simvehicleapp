'use client'

import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Badge, Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { type LogicLine, type LogicState, logicView } from '@/lib/sv/logic-view'
import { SV_ROLE_TAG } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/canvas/block-summary-line'
import { usePanelEditorStore } from '@/stores/panel'
import { useSvCanvasViewStore } from '@/stores/sv/canvas-view/store'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Indentation per nesting level (deeper levels stay at the last one). */
const DEPTH_PADDING = [
  'pl-1',
  'pl-5',
  'pl-9',
  'pl-[52px]',
  'pl-[68px]',
  'pl-[84px]',
  'pl-[100px]',
] as const

/**
 * Logic view over the canvas (ADR-0059 §2, M18-T07): the workflow as sentences, one paragraph per trigger, branches
 * nested under their label. A sentence selects its block and centres the canvas on it; a block with problems shows
 * them in its sentence. Built from the canvas state with `logicView` (deterministic, no LLM).
 */
export function SvLogicPanel() {
  const open = useSvCanvasViewStore((s) => s.logicOpen)
  const blocks = useWorkflowStore((s) => s.blocks)
  const edges = useWorkflowStore((s) => s.edges)
  const loops = useWorkflowStore((s) => s.loops)
  const parallels = useWorkflowStore((s) => s.parallels)
  const byBlock = useSvLintStore((s) => s.byBlock)
  const currentBlockId = usePanelEditorStore((s) => s.currentBlockId)
  const flow = useReactFlow()

  const paragraphs = useMemo(
    () => (open ? logicView({ blocks, edges, loops, parallels } as unknown as LogicState) : []),
    [open, blocks, edges, loops, parallels]
  )
  if (!open) return null

  const select = (line: LogicLine) => {
    usePanelEditorStore.getState().setCurrentBlockId(line.blockId)
    void flow.fitView({ nodes: [{ id: line.blockId }], duration: 400, maxZoom: 1, padding: 0.6 })
  }

  return (
    <aside
      data-sv='logic-view'
      aria-label='Logic view'
      className='absolute top-[44px] left-2 z-20 flex max-h-[calc(100%-96px)] w-[400px] flex-col rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-sm'
    >
      <div className='flex items-center justify-between border-[var(--border)] border-b px-3 py-2'>
        <span className='font-medium text-[var(--text-primary)] text-small'>Logic</span>
        <Button
          variant='ghost'
          size='sm'
          aria-label='Close Logic view'
          onClick={() => useSvCanvasViewStore.getState().setLogicOpen(false)}
        >
          <X className='size-[14px]' />
        </Button>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-2 py-2'>
        {!paragraphs.length && (
          <p className='px-1 text-[var(--text-muted)] text-caption'>
            Add a trigger (When …) to start the workflow.
          </p>
        )}
        {paragraphs.map((p) => (
          <section
            key={p.triggerId ?? 'unreached'}
            data-sv-logic-paragraph={p.triggerId ?? 'unreached'}
            className='mb-3'
          >
            {p.triggerId === null && (
              <p className='px-1 pb-1 text-[var(--text-muted)] text-caption'>
                Not run by any trigger
              </p>
            )}
            {p.lines.map((line, i) => {
              const problems = line.kind === 'branch' ? undefined : byBlock[line.blockId]
              const role = line.role ? SV_ROLE_TAG[line.role] : undefined
              return (
                <button
                  key={`${line.blockId}-${line.kind}-${line.handle ?? ''}-${i}`}
                  type='button'
                  data-sv-logic-line={line.kind}
                  data-sv-logic-block={line.blockId}
                  onClick={() => select(line)}
                  className={cn(
                    DEPTH_PADDING[Math.min(line.depth, DEPTH_PADDING.length - 1)],
                    'flex w-full items-start gap-1.5 rounded-md py-0.5 pr-1 text-left text-small hover:bg-[var(--surface-active)]',
                    line.kind === 'trigger' && 'font-medium',
                    line.kind === 'branch' && 'text-[var(--text-secondary)]',
                    line.kind === 'ref' && 'text-[var(--text-muted)] italic',
                    line.kind !== 'branch' &&
                      line.blockId === currentBlockId &&
                      'bg-[var(--surface-active)]'
                  )}
                >
                  {role && line.kind !== 'branch' && line.kind !== 'ref' && (
                    <Badge variant={role.variant} size='sm' className='shrink-0'>
                      {role.tag}
                    </Badge>
                  )}
                  <span className='min-w-0 flex-1 break-words text-[var(--text-primary)]'>
                    {line.kind === 'branch' ? `${line.text} ⇒` : line.text}
                    {line.kind === 'trigger' ? ':' : ''}
                  </span>
                  {problems && (problems.errors > 0 || problems.warnings > 0) && (
                    <span
                      data-sv-logic-problem
                      title={problems.first}
                      className={cn(
                        'shrink-0 text-caption',
                        problems.errors > 0 ? 'text-[var(--text-error)]' : 'text-[var(--warning)]'
                      )}
                    >
                      {problems.errors > 0 ? `✕ ${problems.first}` : `⚠ ${problems.first}`}
                    </span>
                  )}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </aside>
  )
}
