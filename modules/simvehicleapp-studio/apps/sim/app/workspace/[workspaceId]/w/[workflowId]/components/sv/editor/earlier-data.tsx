'use client'

import { useEffect, useMemo } from 'react'
import { sampleText, sampleValue, usedBy } from '@/lib/sv/earlier-data'
import { usePanelEditorStore } from '@/stores/panel'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * "Data from earlier blocks" (ADR-0059 §5, M18-T08): the editor section under a vehicle block's settings. Outputs of
 * the blocks that run before it show a sample value from the last Simulate or Run and are inserted, on click, into
 * the field edited last; a trigger says it has no inputs; "Used by" lists the blocks that read this block's outputs.
 */

export const SV_EARLIER_DATA_TITLE = 'Data from earlier blocks'
export const SV_EARLIER_DATA_HINT =
  'Outputs of the blocks that run before this one. Click one to insert it in the field you edited last, or drag it.'

/** The text field of the editor panel edited last: where a clicked output goes. */
let lastField: HTMLTextAreaElement | HTMLInputElement | null = null

/** Remembers the last text field focused in the editor panel (mounted once with the editor). */
export function useSvLastFieldTracker() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target
      if (
        (el instanceof HTMLTextAreaElement ||
          (el instanceof HTMLInputElement && (el.type === 'text' || el.type === ''))) &&
        el.closest('[data-tab-content="editor"]')
      )
        lastField = el
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
}

/**
 * Inserts `<tag>` at the caret of the field edited last, through the native value setter so React's controlled field
 * sees an input event. Returns false when there is no such field any more.
 */
export function insertIntoLastField(tag: string): boolean {
  const el = lastField
  if (!el?.isConnected) return false
  const text = `<${tag}>`
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.focus()
  el.setSelectionRange(start + text.length, start + text.length)
  return true
}

/** Sample value of an output: the live run when one is followed, else the last simulation. */
export function useSvSampleValue(blockId: string, path: string): string | null {
  const liveTrace = useSvRunStore((s) => (s.active ? s.entries : null))
  const simTrace = useSvSimulationStore((s) => s.result?.trace ?? null)
  return useMemo(() => {
    const live = liveTrace?.flatMap((e) => (e.kind === 'trace' ? [e.event] : []))
    const v =
      (live && sampleValue(live, blockId, path)) ??
      (simTrace ? sampleValue(simTrace, blockId, path) : undefined)
    return v === undefined ? null : sampleText(v)
  }, [liveTrace, simTrace, blockId, path])
}

/** A trigger has no inputs: said where the data of earlier blocks would be. */
export function SvTriggerHasNoInputs() {
  return (
    <p data-sv='earlier-data-trigger' className='px-2.5 py-2 text-[var(--text-muted)] text-caption'>
      This block starts the workflow — it has no inputs.
    </p>
  )
}

interface SvUsedByProps {
  blockId: string
}

/** Blocks that read this block's outputs; a name selects that block. */
export function SvUsedBy({ blockId }: SvUsedByProps) {
  const blocks = useWorkflowStore((s) => s.blocks)
  const users = useMemo(() => usedBy(blocks, blockId), [blocks, blockId])
  if (!users.length) return null
  return (
    <div data-sv='used-by' className='flex flex-col gap-0.5 px-2.5 pt-1 pb-2'>
      <p className='font-medium text-[var(--text-primary)] text-small'>Used by</p>
      {users.map((u) => (
        <button
          key={u.id}
          type='button'
          data-sv-used-by={u.id}
          onClick={() => usePanelEditorStore.getState().setCurrentBlockId(u.id)}
          className='flex min-w-0 items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-small hover:bg-[var(--surface-active)]'
        >
          <span className='truncate text-[var(--text-primary)]'>{u.name}</span>
          <span className='truncate font-mono text-[var(--text-muted)] text-caption'>
            {u.refs.map((r) => `<${r}>`).join(' ')}
          </span>
        </button>
      ))}
    </div>
  )
}
