import type { SvVssNode } from '@/lib/api/contracts/sv'
import { svT, svTranslate } from '@/lib/sv/i18n'

/** Default block names stay English in both languages; users rename blocks freely (PO 2026-11-01). */
const blockName: typeof svT = (key, vars) => svTranslate('en', key, vars)

import { isVssArray } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'

/**
 * What travels in `dataTransfer` / events when a signal is dragged from the Toolbar signal tree: a VSS signal, or an
 * RSS signal of a robot workflow (`catalog: 'rss'`, with the enum values for its condition).
 */
export type SvDraggedSignal = Pick<SvVssNode, 'path' | 'name' | 'kind' | 'datatype' | 'unit'> & {
  catalog?: 'rss'
  values?: string[]
}

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
  type:
    | 'sv_read_signal'
    | 'sv_on_signal_changed'
    | 'sv_set_actuator'
    | 'sv_read_attribute'
    | 'rf_on_condition'
    | 'rf_if'
    | 'rf_wait_until'
  label: string
  /** Block name on the canvas: the signal name, e.g. "Read Speed" (ADR-0011 §2). */
  blockName: string
  /** Values preset on the new block (VSS: `path`; RSS: the condition `when`). */
  preset: Record<string, string>
}

/** A condition on an RSS signal to start from: `== true`, `== 'FIRST'`, `> 0` (unit kept for the compiler). */
export function rssCondition(
  signal: Pick<SvDraggedSignal, 'path' | 'datatype' | 'unit' | 'values'>
): string {
  // RSS types (`bool`, `float64`, `enum`…) travel in the VSS-typed `datatype` field.
  const type = String(signal.datatype ?? '')
  if (type === 'bool') return `${signal.path} == true`
  if (signal.values?.length) return `${signal.path} == '${signal.values[0]}'`
  if (type === 'string') return `${signal.path} == ''`
  return `${signal.path} > 0${signal.unit ? ` ${signal.unit}` : ''}`
}

/** Blocks offered for a dropped RSS signal: When condition, If / Else, Wait until — each with the condition preset. */
function rssBlockChoices(signal: SvDraggedSignal): SvSignalBlockChoice[] {
  const when = rssCondition(signal)
  return [
    {
      type: 'rf_on_condition',
      label: svT('signal.rss.when'),
      blockName: blockName('signal.rss.whenName', { name: signal.name }),
      preset: { when },
    },
    {
      type: 'rf_if',
      label: svT('signal.rss.if'),
      blockName: blockName('signal.rss.ifName', { name: signal.name }),
      preset: { when },
    },
    {
      type: 'rf_wait_until',
      label: svT('signal.rss.waitUntil'),
      blockName: blockName('signal.rss.waitUntilName', { name: signal.name }),
      preset: { when },
    },
  ]
}

/**
 * Blocks offered for a dropped signal (ADR-0010 §6): sensor → Read, When changes; actuator → Read,
 * When changes, Set (not for arrays, ADR-0018 §2); attribute → Read attribute; branch → nothing.
 * Same rule as `@simvehicleapp/vss` `blocksFor`, kept in sync by the Playwright and unit tests.
 */
export function signalBlockChoices(
  signal: Pick<
    SvDraggedSignal,
    'kind' | 'name' | 'datatype' | 'path' | 'unit' | 'catalog' | 'values'
  >
): SvSignalBlockChoice[] {
  if (signal.catalog === 'rss') return rssBlockChoices(signal)
  const preset = { path: signal.path }
  const read: SvSignalBlockChoice = {
    type: 'sv_read_signal',
    label: svT('signal.read'),
    blockName: blockName('signal.readName', { name: signal.name }),
    preset,
  }
  const changed: SvSignalBlockChoice = {
    type: 'sv_on_signal_changed',
    label: svT('signal.whenChanges'),
    blockName: blockName('signal.whenChangesName', { name: signal.name }),
    preset,
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
            {
              type: 'sv_set_actuator',
              label: svT('signal.set'),
              blockName: blockName('signal.setName', { name: signal.name }),
              preset,
            },
          ]
    case 'attribute':
      return [
        {
          type: 'sv_read_attribute',
          label: svT('signal.readAttribute'),
          blockName: signal.name,
          preset,
        },
      ]
    default:
      return []
  }
}

/** Parses a drop payload; `undefined` when it is not a signal drag (VSS, or RSS sensor/attribute). */
export function parseSignalPayload(data: unknown): SvDraggedSignal | undefined {
  if (!data || typeof data !== 'object') return undefined
  const signal = (data as { svSignal?: unknown }).svSignal
  if (!signal || typeof signal !== 'object') return undefined
  const { path, name, kind, catalog } = signal as Record<string, unknown>
  if (typeof path !== 'string' || typeof name !== 'string') return undefined
  if (catalog === 'rss') {
    if (kind !== 'sensor' && kind !== 'attribute') return undefined
    return signal as SvDraggedSignal
  }
  if (kind !== 'sensor' && kind !== 'actuator' && kind !== 'attribute') return undefined
  return signal as SvDraggedSignal
}

/** Fires the drop menu for `signal` (from the canvas, the empty-workflow overlay or the panel). */
export function dispatchSignalDrop(detail: SvSignalDropDetail): void {
  window.dispatchEvent(new CustomEvent<SvSignalDropDetail>(SV_SIGNAL_DROP_EVENT, { detail }))
}
