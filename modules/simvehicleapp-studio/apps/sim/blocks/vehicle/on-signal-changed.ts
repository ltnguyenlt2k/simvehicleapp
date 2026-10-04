import type { BlockConfig } from '@/blocks/types'
import { SignalChangedIcon, SV_BLOCK_COLORS } from '@/blocks/vehicle/icons'

/** UI config of BlockSpec `sv_on_signal_changed` v1 (core `packages/blocks`, analysis/05 §2.1). */
export const SvOnSignalChangedBlock: BlockConfig = {
  type: 'sv_on_signal_changed',
  name: 'When signal changes',
  description: 'Start a run when a VSS sensor or actuator value changes.',
  longDescription:
    'Subscribes to one VSS signal on the vehicle databroker and starts the steps below each time its value changes, optionally only on rising/falling edges or threshold crossings.',
  category: 'triggers',
  bgColor: SV_BLOCK_COLORS.trigger,
  icon: SignalChangedIcon,
  subBlocks: [
    {
      id: 'path',
      title: 'Signal',
      type: 'vss-path-selector',
      required: true,
      vssKinds: ['sensor', 'actuator'],
    },
    {
      id: 'mode',
      title: 'Fire when',
      type: 'dropdown',
      required: true,
      options: [
        { label: 'Any change', id: 'any' },
        { label: 'Value rises', id: 'rising' },
        { label: 'Value falls', id: 'falling' },
        { label: 'Crosses above threshold', id: 'crosses_above' },
        { label: 'Crosses below threshold', id: 'crosses_below' },
        { label: 'Becomes value', id: 'becomes' },
      ],
      value: () => 'any',
    },
    {
      id: 'threshold',
      title: 'Threshold',
      type: 'sv-typed-value',
      svValueType: '$signal',
      condition: { field: 'mode', value: ['crosses_above', 'crosses_below', 'becomes'] },
    },
    {
      id: 'debounceMs',
      title: 'Debounce',
      type: 'sv-duration',
      svMin: 0,
      defaultValue: 0,
      mode: 'advanced',
    },
    {
      id: 'concurrency',
      title: 'If still running',
      type: 'dropdown',
      options: [
        { label: 'Restart the run', id: 'restart' },
        { label: 'Ignore the change', id: 'ignore' },
        { label: 'Queue it', id: 'queue' },
        { label: 'Run in parallel', id: 'parallel' },
      ],
      value: () => 'restart',
      mode: 'advanced',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {
    value: { type: 'any', description: 'New value (type and unit of the signal)' },
    previous: { type: 'any', description: 'Value before the change' },
    timestamp: { type: 'number', description: 'Time of the change (ms)' },
  },
}
