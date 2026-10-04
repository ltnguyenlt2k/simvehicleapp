import type { SvVssNode } from '@/lib/api/contracts/sv'
import { isVssArray } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'

/** What travels in `dataTransfer` / events when a VSS signal is dragged from the Vehicle panel. */
export type SvDraggedSignal = Pick<SvVssNode, 'path' | 'name' | 'kind' | 'datatype' | 'unit'>

/** `application/json` drag payload; `svSignal` marks a signal drop (handled by the drop menu, not as a block). */
export interface SvSignalDragPayload {
  type: 'sv_signal'
  svSignal: SvDraggedSignal
}

/** Window event fired when a signal is dropped on the canvas or picked in the panel. */
export const SV_SIGNAL_DROP_EVENT = 'sv-signal-drop'

export interface SvSignalDropDetail {
  signal: SvDraggedSignal
  clientX: number
  clientY: number
  /** Picked by click/keyboard in the panel: add at the viewport center instead of the cursor. */
  atViewportCenter?: boolean
}

export interface SvSignalBlockChoice {
  type: 'sv_read_signal' | 'sv_on_signal_changed' | 'sv_set_actuator' | 'sv_read_attribute'
  label: string
  /** Block name on the canvas: the signal name, e.g. "Read Speed" (ADR-0011 §2). */
  blockName: string
}

/**
 * Blocks offered for a dropped signal (ADR-0010 §6): sensor → Read, When changes; actuator → Read,
 * When changes, Set (not for arrays, ADR-0018 §2); attribute → Read attribute; branch → nothing.
 * Same rule as `@simvehicleapp/vss` `blocksFor`, kept in sync by the Playwright and unit tests.
 */
export function signalBlockChoices(
  signal: Pick<SvVssNode, 'kind' | 'name' | 'datatype'>
): SvSignalBlockChoice[] {
  const read: SvSignalBlockChoice = {
    type: 'sv_read_signal',
    label: 'Read',
    blockName: `Read ${signal.name}`,
  }
  const changed: SvSignalBlockChoice = {
    type: 'sv_on_signal_changed',
    label: 'When changes',
    blockName: `When ${signal.name} changes`,
  }
  switch (signal.kind) {
    case 'sensor':
      return [read, changed]
    case 'actuator':
      return isVssArray(signal)
        ? [read, changed]
        : [
            read,
            changed,
            { type: 'sv_set_actuator', label: 'Set', blockName: `Set ${signal.name}` },
          ]
    case 'attribute':
      return [{ type: 'sv_read_attribute', label: 'Read attribute', blockName: signal.name }]
    default:
      return []
  }
}

/** Parses a drop payload; `undefined` when it is not a VSS signal drag. */
export function parseSignalPayload(data: unknown): SvDraggedSignal | undefined {
  if (!data || typeof data !== 'object') return undefined
  const signal = (data as { svSignal?: unknown }).svSignal
  if (!signal || typeof signal !== 'object') return undefined
  const { path, name, kind } = signal as Record<string, unknown>
  if (typeof path !== 'string' || typeof name !== 'string') return undefined
  if (kind !== 'sensor' && kind !== 'actuator' && kind !== 'attribute') return undefined
  return signal as SvDraggedSignal
}

/** Fires the drop menu for `signal` (from the canvas, the empty-workflow overlay or the panel). */
export function dispatchSignalDrop(detail: SvSignalDropDetail): void {
  window.dispatchEvent(new CustomEvent<SvSignalDropDetail>(SV_SIGNAL_DROP_EVENT, { detail }))
}
