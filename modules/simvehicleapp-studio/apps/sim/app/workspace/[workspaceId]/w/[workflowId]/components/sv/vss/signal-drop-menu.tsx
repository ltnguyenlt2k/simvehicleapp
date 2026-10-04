'use client'

import { useEffect, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import {
  SV_SIGNAL_DROP_EVENT,
  type SvSignalBlockChoice,
  type SvSignalDropDetail,
  signalBlockChoices,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/signal-blocks'

/**
 * Adds the chosen block through the canvas' own creation paths: the cursor-positioned drop
 * handler for drags, the viewport-center toolbar handler for panel clicks. The signal is preset
 * in `path` and the block is named after it (ADR-0011 §2, Notes 2026-10-04).
 */
function addSignalBlock(choice: SvSignalBlockChoice, detail: SvSignalDropDetail): void {
  const presetSubBlockValues = { path: detail.signal.path }
  if (detail.atViewportCenter) {
    window.dispatchEvent(
      new CustomEvent('add-block-from-toolbar', {
        detail: { type: choice.type, name: choice.blockName, presetSubBlockValues },
      })
    )
    return
  }
  window.dispatchEvent(
    new CustomEvent('toolbar-drop-on-empty-workflow-overlay', {
      detail: {
        type: choice.type,
        clientX: detail.clientX,
        clientY: detail.clientY,
        name: choice.blockName,
        presetSubBlockValues,
      },
    })
  )
}

/** Menu shown where a VSS signal was dropped: "Read / When changes / Set" by signal kind (M02-T10). */
export function SvSignalDropMenu() {
  const [drop, setDrop] = useState<SvSignalDropDetail | null>(null)

  useEffect(() => {
    const onDrop = (event: Event) => setDrop((event as CustomEvent<SvSignalDropDetail>).detail)
    window.addEventListener(SV_SIGNAL_DROP_EVENT, onDrop)
    return () => window.removeEventListener(SV_SIGNAL_DROP_EVENT, onDrop)
  }, [])

  const choices = drop ? signalBlockChoices(drop.signal) : []

  return (
    <Popover
      open={drop !== null}
      onOpenChange={(open) => !open && setDrop(null)}
      variant='secondary'
      size='sm'
      colorScheme='inverted'
    >
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${drop?.clientX ?? 0}px`,
          top: `${drop?.clientY ?? 0}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent align='start' side='bottom' sideOffset={4} data-sv='signal-drop-menu'>
        {drop && (
          <p className='max-w-[260px] truncate px-2 py-1 font-mono text-caption opacity-70'>
            {drop.signal.path}
          </p>
        )}
        {choices.map((choice) => (
          <PopoverItem
            key={choice.type}
            data-sv-block={choice.type}
            onClick={() => {
              if (drop) addSignalBlock(choice, drop)
              setDrop(null)
            }}
          >
            {choice.label}
          </PopoverItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}
