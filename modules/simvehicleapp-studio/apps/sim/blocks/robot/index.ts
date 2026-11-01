import type { SVGProps } from 'react'
import { createElement } from 'react'
import {
  Bot,
  CircleStop,
  Clock,
  FileText,
  Flag,
  Footprints,
  GitBranch,
  Hand,
  Hourglass,
  MapPin,
  Play,
  Power,
  PowerOff,
  Repeat,
  RotateCcw,
  Route,
  Timer,
} from 'lucide-react'
import snapshot from '@/blocks/robot/rf-registry.json'
import type { BlockConfig, SubBlockConfig, SvHandle } from '@/blocks/types'

/** One property of a RobotFlow block as kept in the studio snapshot (robotics `rf-studio-snapshot.v1`). */
export interface RfProp {
  name: string
  type: 'condition' | 'duration' | 'integer' | 'number' | 'boolean' | 'enum' | 'template' | 'points'
  required: boolean
  default?: string | number | boolean
  values?: string[]
  unit?: string
  min?: number | null
  max?: number | null
  title: { vi: string; en: string }
}

/** One RobotFlow block of the snapshot; `id` is the RobotFlow id (`rf.move`), the studio type is `rf_move`. */
export interface RfBlockSpec {
  id: string
  category: 'trigger' | 'flow' | 'data' | 'safety' | 'motion' | 'navigation'
  title: { vi: string; en: string }
  description: { vi: string; en: string }
  props: RfProp[]
  outputs: string[]
  command?: string
  setpoint?: string
  pending?: string
}

/** A readable RSS signal of the robot profile (for the condition hints and the signal list). */
export interface RfSignal {
  path: string
  kind: string
  type: string
  unit: string
  values: string[]
  description: string
}

const SNAPSHOT = snapshot as {
  profile: string
  catalogHash: string
  blocks: RfBlockSpec[]
  signals: RfSignal[]
}

export const RF_PROFILE = SNAPSHOT.profile
export const RF_CATALOG_HASH = SNAPSHOT.catalogHash
export const RF_BLOCK_SPECS = SNAPSHOT.blocks
export const RF_SIGNALS = SNAPSHOT.signals

/** Studio block type of a RobotFlow block id (`rf.go_to` → `rf_go_to`). */
export const rfType = (id: string) => id.replace('.', '_')
/** RobotFlow block id of a studio block type (`rf_go_to` → `rf.go_to`). */
export const rfId = (type: string) => type.replace(/^rf_/, 'rf.')

const CATEGORY_COLORS: Record<RfBlockSpec['category'], string> = {
  trigger: '#10B981',
  flow: '#64748B',
  data: '#0EA5E9',
  safety: '#DC2626',
  motion: '#F97316',
  navigation: '#7C3AED',
}

const ICONS: Record<string, typeof Bot> = {
  'rf.on_start': Play,
  'rf.on_condition': Flag,
  'rf.every': Timer,
  'rf.if': GitBranch,
  'rf.wait': Hourglass,
  'rf.wait_until': Clock,
  'rf.repeat': Repeat,
  'rf.log': FileText,
  'rf.end': Flag,
  'rf.arm': Power,
  'rf.disarm': PowerOff,
  'rf.stop': CircleStop,
  'rf.reset_stop': RotateCcw,
  'rf.move': Footprints,
  'rf.perform': Hand,
  'rf.go_to': MapPin,
  'rf.follow_route': Route,
}

const PORT_LABELS: Record<string, string> = {
  next: 'tiếp',
  then: 'đúng',
  else: 'sai',
  ok: 'xong',
  failed: 'lỗi',
  timeout: 'hết giờ',
  body: 'lặp',
  done: 'xong lặp',
}

const MOTION_LABELS: Record<string, string> = {
  CROUCH: 'Hạ thân',
  BOW: 'Cúi chào',
  TILT: 'Nghiêng thân',
  LIFT_FRONT_LEFT: 'Giơ chân trước trái',
  JUMP: 'Nhảy',
  WAVE_FRONT_LEFT: 'Vẫy chân trước trái',
  SIT: 'Ngồi',
  STAND: 'Đứng dậy',
}

const icon = (Icon: typeof Bot) => (props: SVGProps<SVGSVGElement>) => createElement(Icon, props)

const SIGNAL_HINT = RF_SIGNALS.filter((s) => !s.path.includes('.Joint.'))
  .slice(0, 12)
  .map((s) => s.path)
  .join(', ')

/** RobotFlow property → studio subBlock; every value stays a plain string/boolean so the adapter can type it. */
function subBlockFor(prop: RfProp): SubBlockConfig {
  const base = { id: prop.name, title: prop.title.vi, required: prop.required }
  const fallback = prop.default === undefined ? undefined : String(prop.default)
  switch (prop.type) {
    case 'condition':
      return {
        ...base,
        type: 'long-input',
        rows: 2,
        placeholder: `Ví dụ: ${fallback ?? 'Robot.Safety.Mode == "MANUAL"'} — tín hiệu: ${SIGNAL_HINT}`,
        defaultValue: fallback,
      }
    case 'template':
      return { ...base, type: 'long-input', rows: 2, defaultValue: fallback }
    case 'enum':
      return {
        ...base,
        type: 'dropdown',
        options: (prop.values ?? []).map((v) => ({ id: v, label: MOTION_LABELS[v] ?? v })),
        value: () => fallback ?? prop.values?.[0] ?? '',
      }
    case 'boolean':
      return { ...base, type: 'switch', defaultValue: prop.default === true }
    case 'points':
      return {
        ...base,
        type: 'short-input',
        placeholder: 'X,Y; X,Y (mét, khung map)',
        defaultValue: fallback,
      }
    default: {
      const range =
        prop.min !== undefined && prop.min !== null && prop.max !== undefined && prop.max !== null
          ? ` [${prop.min}…${prop.max}]`
          : ''
      return {
        ...base,
        type: 'short-input',
        placeholder: `${fallback ?? ''}${range}`,
        defaultValue: fallback,
      }
    }
  }
}

function blockFromSpec(spec: RfBlockSpec): BlockConfig {
  const handles: SvHandle[] = spec.outputs.map((id) => ({ id, label: PORT_LABELS[id] ?? id }))
  const pending = spec.pending ? ` (Robot ROS: ${spec.pending})` : ''
  return {
    type: rfType(spec.id),
    name: spec.title.vi,
    description: spec.description.vi,
    longDescription: `${spec.description.vi}${pending} — ${spec.description.en}`,
    category: spec.category === 'trigger' ? 'triggers' : 'blocks',
    bgColor: CATEGORY_COLORS[spec.category],
    icon: icon(ICONS[spec.id] ?? Bot),
    subBlocks: spec.props.map(subBlockFor),
    tools: { access: [] },
    inputs: {},
    outputs: {},
    svHandles: handles,
  }
}

/** Robot-domain blocks (ADR-0068): built from the RobotFlow registry snapshot, registered under `// SV:`. */
export const SV_ROBOT_BLOCKS: Record<string, BlockConfig> = Object.fromEntries(
  RF_BLOCK_SPECS.map((spec) => [rfType(spec.id), blockFromSpec(spec)])
)
