import type { BlockConfig } from '@/blocks/types'
import { SvOnSignalChangedBlock } from '@/blocks/vehicle/on-signal-changed'
import { SvReadAttributeBlock } from '@/blocks/vehicle/read-attribute'
import { SvReadSignalBlock } from '@/blocks/vehicle/read-signal'
import { SvSetActuatorBlock } from '@/blocks/vehicle/set-actuator'

/** SimVehicleApp vehicle blocks (ADR-0011 §3), registered in `blocks/registry.ts` under `// SV:`. */
export const SV_VEHICLE_BLOCKS: Record<string, BlockConfig> = {
  sv_on_signal_changed: SvOnSignalChangedBlock,
  sv_read_attribute: SvReadAttributeBlock,
  sv_read_signal: SvReadSignalBlock,
  sv_set_actuator: SvSetActuatorBlock,
}

export { SvOnSignalChangedBlock, SvReadAttributeBlock, SvReadSignalBlock, SvSetActuatorBlock }
