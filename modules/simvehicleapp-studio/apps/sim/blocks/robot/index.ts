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
import { type SvLocale, type SvMessageKey, svClientLocale, svT } from '@/lib/sv/i18n'
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

/** Port and motion names in the page's language (ADR-0072); the ids stay the RobotFlow ones. */
const PORT_KEYS: Record<string, SvMessageKey> = {
  next: 'rf.port.next',
  then: 'rf.port.then',
  else: 'rf.port.else',
  ok: 'rf.port.ok',
  failed: 'rf.port.failed',
  timeout: 'rf.port.timeout',
  body: 'rf.port.body',
  done: 'rf.port.done',
}

/** Display name of a named motion (`BOW` → "Bow" / "Cúi chào"). */
export function rfMotionLabel(name: string): string {
  const key = `rf.motion.${name}` as SvMessageKey
  const text = svT(key)
  return text === key ? name : text
}

/** Display name of an output port (`ok` → "done" / "xong"). */
export function rfPortLabel(port: string): string {
  const key = PORT_KEYS[port]
  return key ? svT(key) : port
}

const icon = (Icon: typeof Bot) => (props: SVGProps<SVGSVGElement>) => createElement(Icon, props)

const SIGNAL_HINT = RF_SIGNALS.filter((s) => !s.path.includes('.Joint.'))
  .slice(0, 12)
  .map((s) => s.path)
  .join(', ')

/** RobotFlow property → studio subBlock; every value stays a plain string/boolean so the adapter can type it. */
function subBlockFor(prop: RfProp, locale: SvLocale): SubBlockConfig {
  const base = { id: prop.name, title: prop.title[locale], required: prop.required }
  const fallback = prop.default === undefined ? undefined : String(prop.default)
  switch (prop.type) {
    case 'condition':
      return {
        ...base,
        type: 'long-input',
        rows: 2,
        placeholder: svT('rf.placeholder.condition', {
          example: fallback ?? "Robot.Safety.Mode == 'MANUAL'",
          signals: SIGNAL_HINT,
        }),
        defaultValue: fallback,
      }
    case 'template':
      return { ...base, type: 'long-input', rows: 2, defaultValue: fallback }
    case 'enum':
      return {
        ...base,
        type: 'dropdown',
        options: (prop.values ?? []).map((v) => ({ id: v, label: rfMotionLabel(v) })),
        value: () => fallback ?? prop.values?.[0] ?? '',
      }
    case 'boolean':
      return { ...base, type: 'switch', defaultValue: prop.default === true }
    case 'points':
      return {
        ...base,
        type: 'short-input',
        placeholder: svT('rf.placeholder.points'),
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

function blockFromSpec(spec: RfBlockSpec, locale: SvLocale): BlockConfig {
  const handles: SvHandle[] = spec.outputs.map((id) => ({ id, label: rfPortLabel(id) }))
  const pending = spec.pending ? ` (${svT('rf.pending', { detail: spec.pending })})` : ''
  return {
    type: rfType(spec.id),
    // Default block names stay English in both languages; users rename blocks freely (PO 2026-11-01).
    name: spec.title.en,
    description: spec.description[locale],
    longDescription: `${spec.description[locale]}${pending}`,
    category: spec.category === 'trigger' ? 'triggers' : 'blocks',
    bgColor: CATEGORY_COLORS[spec.category],
    icon: icon(ICONS[spec.id] ?? Bot),
    subBlocks: spec.props.map((prop) => subBlockFor(prop, locale)),
    tools: { access: [] },
    inputs: {},
    outputs: {},
    svHandles: handles,
  }
}

/** Robot-domain blocks (ADR-0068): built from the RobotFlow registry snapshot, registered under `// SV:`. */
export const SV_ROBOT_BLOCKS: Record<string, BlockConfig> = Object.fromEntries(
  RF_BLOCK_SPECS.map((spec) => [rfType(spec.id), blockFromSpec(spec, svClientLocale())])
)
