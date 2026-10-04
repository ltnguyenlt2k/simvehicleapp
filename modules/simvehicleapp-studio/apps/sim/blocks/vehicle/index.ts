import type { BlockConfig } from '@/blocks/types'
import { SV_M3_BLOCKS } from '@/blocks/vehicle/m3-blocks'
import { SvOnSignalChangedBlock } from '@/blocks/vehicle/on-signal-changed'
import { SvReadAttributeBlock } from '@/blocks/vehicle/read-attribute'
import { SvReadSignalBlock } from '@/blocks/vehicle/read-signal'
import { SvSetActuatorBlock } from '@/blocks/vehicle/set-actuator'

/** SimVehicleApp blocks (ADR-0011 §3): M2 vehicle blocks + M3 logic/flow/state/comm, registered in `blocks/registry.ts` under `// SV:`. */
export const SV_VEHICLE_BLOCKS: Record<string, BlockConfig> = {
  sv_on_signal_changed: SvOnSignalChangedBlock,
  sv_read_attribute: SvReadAttributeBlock,
  sv_read_signal: SvReadSignalBlock,
  sv_set_actuator: SvSetActuatorBlock,
  ...SV_M3_BLOCKS,
}

export { SvOnSignalChangedBlock, SvReadAttributeBlock, SvReadSignalBlock, SvSetActuatorBlock }
