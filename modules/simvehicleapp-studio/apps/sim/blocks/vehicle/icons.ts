import type { SVGProps } from 'react'
import { createElement } from 'react'
import {
  Activity,
  BatteryCharging,
  Bell,
  Brackets,
  Calculator,
  CircleStop,
  Clock,
  Database,
  DoorOpen,
  FileText,
  Gauge,
  GitBranch,
  Hourglass,
  Info,
  Power,
  Radio,
  Send,
  Sigma,
  SlidersHorizontal,
  Thermometer,
  Timer,
  ToggleLeft,
  Workflow,
} from 'lucide-react'

/** Block icons by VSS kind (ADR-0011 §2): trigger, sensor read, attribute read, actuator write. */
export const SignalChangedIcon = (props: SVGProps<SVGSVGElement>) => createElement(Activity, props)
export const ReadSignalIcon = (props: SVGProps<SVGSVGElement>) => createElement(Gauge, props)
export const ReadAttributeIcon = (props: SVGProps<SVGSVGElement>) => createElement(Info, props)
export const SetActuatorIcon = (props: SVGProps<SVGSVGElement>) =>
  createElement(SlidersHorizontal, props)

const icon = (Icon: typeof Activity) => (props: SVGProps<SVGSVGElement>) =>
  createElement(Icon, props)

/** Icons of the M3 logic/flow/state/comm blocks. */
export const SvIcons = {
  appStart: icon(Power),
  timer: icon(Timer),
  mqtt: icon(Radio),
  condition: icon(ToggleLeft),
  compare: icon(Sigma),
  logic: icon(GitBranch),
  math: icon(Calculator),
  expression: icon(Brackets),
  constant: icon(Database),
  array: icon(Brackets),
  branch: icon(GitBranch),
  wait: icon(Hourglass),
  stable: icon(Clock),
  stop: icon(CircleStop),
  flow: icon(Workflow),
  variable: icon(Database),
  log: icon(FileText),
  publish: icon(Send),
  hmi: icon(Bell),
  battery: icon(BatteryCharging),
  door: icon(DoorOpen),
  climate: icon(Thermometer),
} as const

/** Block colors by kind; sensors use the SimVehicleApp brand cyan. */
export const SV_BLOCK_COLORS = {
  trigger: '#10B981',
  sensor: '#0FC0FF',
  attribute: '#8B5CF6',
  actuator: '#F97316',
  logic: '#6366F1',
  flow: '#64748B',
  state: '#14B8A6',
  comm: '#EC4899',
  /** Curated multi-signal blocks (analysis/05 §1: brown). */
  composite: '#A16207',
} as const
