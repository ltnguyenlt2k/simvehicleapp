import type { SVGProps } from 'react'
import { createElement } from 'react'
import { Activity, Gauge, Info, SlidersHorizontal } from 'lucide-react'

/** Block icons by VSS kind (ADR-0011 §2): trigger, sensor read, attribute read, actuator write. */
export const SignalChangedIcon = (props: SVGProps<SVGSVGElement>) => createElement(Activity, props)
export const ReadSignalIcon = (props: SVGProps<SVGSVGElement>) => createElement(Gauge, props)
export const ReadAttributeIcon = (props: SVGProps<SVGSVGElement>) => createElement(Info, props)
export const SetActuatorIcon = (props: SVGProps<SVGSVGElement>) =>
  createElement(SlidersHorizontal, props)

/** Block colors by kind; sensors use the SimVehicleApp brand cyan. */
export const SV_BLOCK_COLORS = {
  trigger: '#10B981',
  sensor: '#0FC0FF',
  attribute: '#8B5CF6',
  actuator: '#F97316',
} as const
