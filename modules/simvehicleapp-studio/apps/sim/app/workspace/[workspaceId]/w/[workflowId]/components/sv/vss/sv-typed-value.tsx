'use client'

import { useState } from 'react'
import { ChipInput, ChipSelect } from '@/components/emcn'
import type { SvVssNode } from '@/lib/api/contracts/sv'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  allowedValueOf,
  formatTypedValue,
  isSvScalarType,
  parseTypedInput,
  type SvScalarType,
  type SvScalarValue,
  type SvValueDomain,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/typed-value'
import { useSvWorkflowRelease } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release'
import { isVssArray } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'
import { useSvCatalogNode } from '@/hooks/queries/sv-catalog'

/** Where a typed editor gets its type from: the bound signal, or a fixed scalar type. */
/** `$type` = the scalar type chosen in the block's `type` subBlock (sv_constant). */
export type SvValueTypeSource = '$signal' | '$type' | SvScalarType

interface HintProps {
  children: React.ReactNode
  tone?: 'muted' | 'error'
}

function Hint({ children, tone = 'muted' }: HintProps) {
  return (
    <p
      className={
        tone === 'error'
          ? 'text-[var(--text-error)] text-caption'
          : 'text-[var(--text-muted)] text-caption'
      }
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </p>
  )
}

interface ResolvedType {
  status: 'ready' | 'no-path' | 'loading' | 'unknown-path' | 'array'
  type?: SvScalarType
  node?: SvVssNode
}

/** Resolves `$signal` through the block's `path` subBlock and the catalog. */
function useResolvedType(
  blockId: string,
  valueType: SvValueTypeSource,
  pathSubBlockId: string,
  release: string | undefined,
  isPreview: boolean,
  previewPath: string | undefined
): ResolvedType {
  const [storePath] = useSubBlockValue<string>(blockId, pathSubBlockId)
  const [typeChoice] = useSubBlockValue<string>(blockId, 'type')
  const path =
    valueType === '$signal' ? (isPreview ? previewPath : storePath) || undefined : undefined
  const { data } = useSvCatalogNode(release, path)
  if (valueType === '$type') {
    return isSvScalarType(typeChoice)
      ? { status: 'ready', type: typeChoice }
      : { status: 'no-path' }
  }
  if (valueType !== '$signal') return { status: 'ready', type: valueType }
  if (!path) return { status: 'no-path' }
  if (data === undefined) return { status: 'loading' }
  if (!data.node || !isSvScalarType(data.node.datatype?.replace('[]', ''))) {
    return { status: 'unknown-path' }
  }
  if (isVssArray(data.node)) return { status: 'array', node: data.node }
  return { status: 'ready', type: data.node.datatype as SvScalarType, node: data.node }
}

interface TypedTextFieldProps {
  initial: string
  type: SvScalarType
  domain?: SvValueDomain
  unit?: string
  required: boolean
  disabled: boolean
  onCommit: (value: SvScalarValue | null) => void
}

/**
 * Free-text editor for numbers/strings. The draft lives here; the parent remounts it (via `key`)
 * when the stored value changes elsewhere (collaborator, undo), so no prop→state sync effect.
 */
function TypedTextField({
  initial,
  type,
  domain,
  unit,
  required,
  disabled,
  onCommit,
}: TypedTextFieldProps) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | undefined>()

  const commit = () => {
    if (draft.trim() === '' && type !== 'string') {
      setError(required ? 'A value is required' : undefined)
      if (!required) onCommit(null)
      return
    }
    const parsed = parseTypedInput(draft, type, domain)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(undefined)
    onCommit(parsed.value)
  }

  return (
    <div className='flex flex-col gap-1'>
      <ChipInput
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        error={Boolean(error)}
        disabled={disabled}
        inputMode={type === 'string' ? 'text' : 'decimal'}
        placeholder={type === 'string' ? 'Text' : `${type}${unit ? ` (${unit})` : ''}`}
        aria-label={`Value (${type})`}
        endAdornment={
          unit ? <span className='text-[var(--text-muted)] text-caption'>{unit}</span> : undefined
        }
      />
      {error && <Hint tone='error'>{error}</Hint>}
    </div>
  )
}

interface EnumSelectProps {
  allowed: readonly SvScalarValue[]
  value: unknown
  disabled: boolean
  onChange: (value: SvScalarValue) => void
}

function EnumSelect({ allowed, value, disabled, onChange }: EnumSelectProps) {
  return (
    <ChipSelect
      options={allowed.map((a) => ({ label: String(a), value: String(a) }))}
      value={value === null || value === undefined ? undefined : String(value)}
      onChange={(selected) => {
        const typed = allowedValueOf(allowed, selected)
        if (typed !== undefined) onChange(typed)
      }}
      placeholder='Choose a value'
      searchable={allowed.length > 8}
      disabled={disabled}
    />
  )
}

interface SvTypedValueInputProps {
  blockId: string
  subBlockId: string
  /** `$signal` = datatype of the selected VSS path (BlockSpec `valueType`). */
  valueType?: SvValueTypeSource
  /** subBlock holding the VSS path when `valueType` is `$signal`. */
  pathSubBlockId?: string
  /** Unit label for fixed types (e.g. `ms`); signal units come from the catalog. */
  unit?: string
  required?: boolean
  /** `enum` = only the catalog `allowed` values (subBlock `sv-enum`). */
  mode?: 'value' | 'enum'
  release?: string
  isPreview?: boolean
  previewValue?: unknown
  previewPath?: string
  disabled?: boolean
}

/**
 * SubBlocks `sv-typed-value` / `sv-enum` (ADR-0011 §5, ADR-0018, M02-T08): a literal checked
 * against the VSS datatype and the catalog domain. Booleans and `allowed` lists are pick-only;
 * array signals are read-only (no write path in v1); int64/uint64 are stored as decimal strings.
 */
export function SvTypedValueInput({
  blockId,
  subBlockId,
  valueType = '$signal',
  pathSubBlockId = 'path',
  unit,
  required = false,
  mode = 'value',
  release: releaseProp,
  isPreview = false,
  previewValue,
  previewPath,
  disabled = false,
}: SvTypedValueInputProps) {
  const workflowRelease = useSvWorkflowRelease()
  const release = releaseProp ?? workflowRelease
  const [storeValue, setStoreValue] = useSubBlockValue<SvScalarValue | null>(blockId, subBlockId)
  const resolved = useResolvedType(
    blockId,
    valueType,
    pathSubBlockId,
    release,
    isPreview,
    previewPath
  )
  const value = isPreview ? previewValue : storeValue
  const readOnly = isPreview || disabled

  if (resolved.status === 'no-path') {
    return <Hint>{valueType === '$type' ? 'Choose a type first' : 'Pick a signal first'}</Hint>
  }
  if (resolved.status === 'loading') return <Hint>Loading signal type…</Hint>
  if (resolved.status === 'unknown-path')
    return <Hint tone='error'>Signal not found in catalog</Hint>
  if (resolved.status === 'array') {
    return <Hint>{resolved.node?.datatype} values are read-only (ADR-0018)</Hint>
  }

  const type = resolved.type as SvScalarType
  const node = resolved.node
  const allowed = node?.allowed

  if (allowed && allowed.length > 0) {
    return (
      <EnumSelect
        allowed={allowed}
        value={value}
        disabled={readOnly}
        onChange={(v) => setStoreValue(v)}
      />
    )
  }
  if (mode === 'enum') return <Hint>This signal has no list of allowed values</Hint>
  if (type === 'boolean') {
    return (
      <EnumSelect
        allowed={[true, false]}
        value={value}
        disabled={readOnly}
        onChange={(v) => setStoreValue(v)}
      />
    )
  }
  return (
    <TypedTextField
      key={`${type}:${formatTypedValue(value)}`}
      initial={formatTypedValue(value)}
      type={type}
      domain={node}
      unit={node?.unit ?? unit}
      required={required}
      disabled={readOnly}
      onCommit={(v) => setStoreValue(v)}
    />
  )
}
