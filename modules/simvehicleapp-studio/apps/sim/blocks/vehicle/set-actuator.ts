import type { BlockConfig } from '@/blocks/types'
import { SetActuatorIcon, SV_BLOCK_COLORS } from '@/blocks/vehicle/icons'

/**
 * UI config of BlockSpec `sv_set_actuator` v1 (core `packages/blocks`, analysis/05 §2.3). `value` is
 * an SVX expression; the editor offers quick picks for boolean/`allowed` actuators.
 */
export const SvSetActuatorBlock: BlockConfig = {
  type: 'sv_set_actuator',
  name: 'Set actuator',
  description: 'Write a target value to a VSS actuator.',
  longDescription:
    'Sends a target value to one VSS actuator on the vehicle databroker, optionally waiting for it to be accepted. Sensors and attributes cannot be written.',
  category: 'blocks',
  bgColor: SV_BLOCK_COLORS.actuator,
  icon: SetActuatorIcon,
  subBlocks: [
    {
      id: 'path',
      title: 'Actuator',
      type: 'vss-path-selector',
      required: true,
      vssKinds: ['actuator'],
      vssWrites: true,
    },
    {
      id: 'value',
      title: 'Value',
      type: 'sv-expression',
      required: true,
      svValueType: '$signal',
      placeholder: 'e.g. true, 50, <readspeed1.value> > 100',
    },
    {
      id: 'awaitAck',
      title: 'Wait until the vehicle accepts the value',
      type: 'switch',
      defaultValue: true,
      mode: 'advanced',
    },
    {
      id: 'onError',
      title: 'On error (when the error path is not connected)',
      type: 'dropdown',
      options: [
        { label: 'Log and continue', id: 'continue' },
        { label: 'Stop the run', id: 'stop' },
      ],
      value: () => 'continue',
      mode: 'advanced',
    },
  ],
  tools: { access: [] },
  inputs: {},
  outputs: {
    ok: { type: 'boolean', description: 'True when the write succeeded' },
    error: { type: 'string', description: 'Error message when the write failed' },
  },
}
