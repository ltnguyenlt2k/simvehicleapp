import type { BlockConfig } from '@/blocks/types'
import { ReadAttributeIcon, SV_BLOCK_COLORS } from '@/blocks/vehicle/icons'

/** UI config of BlockSpec `sv_read_attribute` v1 (core `packages/blocks`, analysis/05 §2.2). */
export const SvReadAttributeBlock: BlockConfig = {
  type: 'sv_read_attribute',
  name: 'Read attribute',
  description: 'Use a static vehicle attribute such as the VIN or the door count.',
  longDescription:
    'Reads one VSS attribute. Attributes do not change while the app runs; the value is read once at start.',
  category: 'blocks',
  bgColor: SV_BLOCK_COLORS.attribute,
  icon: ReadAttributeIcon,
  subBlocks: [
    {
      id: 'path',
      title: 'Attribute',
      type: 'vss-path-selector',
      required: true,
      vssKinds: ['attribute'],
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {
    value: { type: 'any', description: 'Attribute value (type and unit of the attribute)' },
  },
}
