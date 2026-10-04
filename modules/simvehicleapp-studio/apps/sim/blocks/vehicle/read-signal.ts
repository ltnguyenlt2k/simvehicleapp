import type { BlockConfig } from '@/blocks/types'
import { ReadSignalIcon, SV_BLOCK_COLORS } from '@/blocks/vehicle/icons'

/** UI config of BlockSpec `sv_read_signal` v1 (core `packages/blocks`, analysis/05 §2.2). */
export const SvReadSignalBlock: BlockConfig = {
  type: 'sv_read_signal',
  name: 'Read signal',
  description: 'Read the current value of a VSS sensor or actuator.',
  longDescription:
    'Reads one VSS signal: the latest value the app already knows (no wait) or a fresh read from the vehicle databroker.',
  category: 'blocks',
  bgColor: SV_BLOCK_COLORS.sensor,
  icon: ReadSignalIcon,
  subBlocks: [
    {
      id: 'path',
      title: 'Signal',
      type: 'vss-path-selector',
      required: true,
      vssKinds: ['sensor', 'actuator'],
    },
    {
      id: 'source',
      title: 'Read',
      type: 'dropdown',
      options: [
        { label: 'Latest known value', id: 'latest-from-trigger' },
        { label: 'Fresh read from the vehicle', id: 'fresh-read' },
      ],
      value: () => 'latest-from-trigger',
      mode: 'advanced',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {
    value: { type: 'any', description: 'Signal value (type and unit of the signal)' },
    timestamp: { type: 'number', description: 'Time the value was recorded (ms)' },
  },
}
