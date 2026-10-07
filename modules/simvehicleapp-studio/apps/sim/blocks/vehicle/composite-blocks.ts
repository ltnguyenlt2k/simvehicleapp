import type { BlockConfig } from '@/blocks/types'
import { blockFromSpec, type PropUi } from '@/blocks/vehicle/factory'
import { SV_BLOCK_COLORS as C, SvIcons as I } from '@/blocks/vehicle/icons'

const SOURCE: PropUi = {
  title: 'Read',
  labels: {
    'latest-from-trigger': 'Latest known values',
    'fresh-read': 'Fresh read from the vehicle',
  },
  advanced: true,
}

/** Curated multi-signal status blocks (ADR-0045): one step reading several VSS signals. */
export const SV_COMPOSITE_BLOCKS: Record<string, BlockConfig> = {
  sv_battery_status: blockFromSpec('sv_battery_status', {
    name: 'Battery status',
    description:
      'Read state of charge, voltage, current and charging state of the traction battery.',
    longDescription:
      'One step that reads four traction battery signals. If one of them has no value yet, the error branch runs.',
    icon: I.battery,
    bgColor: C.composite,
    props: { source: SOURCE },
  }),
  sv_door_status: blockFromSpec('sv_door_status', {
    name: 'Door status',
    description: 'Read whether a door is open, locked and child-locked.',
    longDescription:
      'One step that reads the open, locked and child lock signals of the chosen door. If one of them has no value yet, the error branch runs.',
    icon: I.door,
    bgColor: C.composite,
    props: {
      door: {
        labels: {
          'Row1.DriverSide': 'Front, driver side',
          'Row1.PassengerSide': 'Front, passenger side',
          'Row2.DriverSide': 'Rear, driver side',
          'Row2.PassengerSide': 'Rear, passenger side',
        },
      },
      source: SOURCE,
    },
  }),
  sv_climate_status: blockFromSpec('sv_climate_status', {
    name: 'Climate status',
    description: 'Read cabin and outside temperature, set temperature, fan speed and A/C state.',
    longDescription:
      'One step that reads five HVAC signals for the chosen seat station. If one of them has no value yet, the error branch runs.',
    icon: I.climate,
    bgColor: C.composite,
    props: {
      station: {
        title: 'Seat',
        labels: { 'Row1.Driver': 'Driver', 'Row1.Passenger': 'Front passenger' },
      },
      source: SOURCE,
    },
  }),
}
