import type { BlockConfig, OutputFieldDefinition, SubBlockConfig } from '@/blocks/types'
import specsSnapshot from '@/blocks/vehicle/block-specs.json'
import { useVariablesStore } from '@/stores/variables/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/** Shape of the compiler's `GET /blocks` entries (contracts `block-spec.v1`), as kept in the snapshot. */
export interface SpecProp {
  name: string
  kind: string
  required: boolean
  default?: unknown
  enum?: (string | number | boolean)[]
  valueType?: string
  min?: number
  max?: number
  items?: SpecProp[]
}
export interface Spec {
  type: string
  category: string
  title: string
  vssKinds?: string[]
  container?: boolean
  props: SpecProp[]
  outputs: { name: string; type: string }[]
  handles: { in: string[]; out: string[] }
}

export const SPECS = (specsSnapshot as { blocks: Spec[] }).blocks

/** UI-only knobs per prop: everything semantic comes from the BlockSpec. */
export interface PropUi {
  title?: string
  placeholder?: string
  /** Display label per enum value. */
  labels?: Record<string, string>
  advanced?: boolean
  /** Pick from the workflow variables (Sim Variables panel, M03-T09) instead of free text. */
  variablePicker?: boolean
}

/**
 * Variables declared in the open workflow's Variables panel (M03-T09), as dropdown options. The
 * Sim panel already stores name/type/initial value per workflow and syncs them in real time.
 */
export async function workflowVariableOptions(): Promise<Array<{ label: string; id: string }>> {
  const workflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!workflowId) return []
  return useVariablesStore
    .getState()
    .getVariablesByWorkflowId(workflowId)
    .map((v) => ({ id: v.name, label: `${v.name} (${v.type})` }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export interface BlockUi {
  name: string
  description: string
  longDescription?: string
  icon: BlockConfig['icon']
  bgColor: string
  props?: Record<string, PropUi>
  /** Labels of the spec's named branch handles, or a function for value-dependent handles. */
  handles?: BlockConfig['svHandles']
}

const NUMERIC = new Set([
  'int8',
  'int16',
  'int32',
  'int64',
  'uint8',
  'uint16',
  'uint32',
  'uint64',
  'float',
  'double',
])

/** Canvas output type for a BlockSpec output type (signal-typed values are `any`). */
export function outputType(type: string): OutputFieldDefinition {
  if (NUMERIC.has(type) || type === 'timestamp' || type === 'duration') return 'number'
  if (type === 'boolean' || type === 'string' || type === 'json') return type
  return 'any'
}

const titleCase = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** BlockSpec prop → studio subBlock (ADR-0011 §5; the mapping `block-parity.test.ts` checks). */
export function subBlockFor(prop: SpecProp, ui: PropUi = {}): SubBlockConfig {
  const base = {
    id: prop.name,
    title: ui.title ?? titleCase(prop.name),
    required: prop.required,
    ...(ui.placeholder ? { placeholder: ui.placeholder } : {}),
    ...(ui.advanced ? { mode: 'advanced' as const } : {}),
  }
  const withDefault =
    prop.default === undefined
      ? {}
      : { defaultValue: prop.default as SubBlockConfig['defaultValue'] }
  switch (prop.kind) {
    case 'vss-path':
      return { ...base, type: 'vss-path-selector' }
    case 'expression':
      return {
        ...base,
        type: 'sv-expression',
        ...(prop.valueType === '$signal' ? { svValueType: '$signal' as const } : {}),
      }
    case 'template':
      return { ...base, type: 'long-input', rows: 3 }
    case 'duration':
      return { ...base, ...withDefault, type: 'sv-duration', svMin: prop.min ?? 0 }
    case 'enum':
      return {
        ...base,
        type: 'dropdown',
        options: (prop.enum ?? []).map((v) => ({
          id: String(v),
          label: ui.labels?.[String(v)] ?? String(v),
        })),
        ...(prop.default === undefined ? {} : { value: () => String(prop.default) }),
      }
    case 'typed-value':
      return {
        ...base,
        type: 'sv-typed-value',
        svValueType: prop.valueType === '$signal' ? '$signal' : '$type',
      }
    case 'integer':
      return {
        ...base,
        ...withDefault,
        type: 'sv-typed-value',
        svValueType: (prop.min ?? -1) >= 0 ? 'uint32' : 'int32',
      }
    case 'number':
      return { ...base, ...withDefault, type: 'sv-typed-value', svValueType: 'double' }
    case 'boolean':
      return { ...base, ...withDefault, type: 'switch' }
    case 'string':
      if (ui.variablePicker) {
        return {
          ...base,
          type: 'dropdown',
          options: [],
          fetchOptions: workflowVariableOptions,
          searchable: true,
        }
      }
      return { ...base, ...withDefault, type: 'short-input' }
    case 'list':
      return { ...base, type: 'table', columns: (prop.items ?? []).map((i) => i.name) }
    default:
      throw new Error(`No studio editor for BlockSpec prop kind '${prop.kind}'`)
  }
}

/**
 * Builds the Sim BlockConfig of a SimVehicleApp block from its BlockSpec snapshot plus UI text,
 * so semantics (props, defaults, enums, outputs, handles) cannot drift from the compiler.
 */
export function blockFromSpec(type: string, ui: BlockUi): BlockConfig {
  const spec = SPECS.find((s) => s.type === type)
  if (!spec) throw new Error(`BlockSpec ${type} is not in block-specs.json`)
  const outputs: BlockConfig['outputs'] = {}
  for (const o of spec.outputs)
    outputs[o.name] = { type: outputType(o.type) } as BlockConfig['outputs'][string]
  const defaultHandles =
    spec.category === 'triggers' ||
    (spec.handles.out.length === 2 &&
      spec.handles.out[0] === 'source' &&
      spec.handles.out[1] === 'error')
  return {
    type,
    name: ui.name,
    description: ui.description,
    ...(ui.longDescription ? { longDescription: ui.longDescription } : {}),
    category: spec.category === 'triggers' ? 'triggers' : 'blocks',
    bgColor: ui.bgColor,
    icon: ui.icon,
    subBlocks: spec.props.map((p) => subBlockFor(p, ui.props?.[p.name])),
    tools: { access: [] },
    inputs: {},
    outputs,
    ...(defaultHandles
      ? {}
      : { svHandles: ui.handles ?? spec.handles.out.map((id) => ({ id, label: id })) }),
  }
}
