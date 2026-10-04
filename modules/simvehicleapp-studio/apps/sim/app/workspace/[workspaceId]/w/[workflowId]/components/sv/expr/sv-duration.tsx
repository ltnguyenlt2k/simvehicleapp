'use client'

import { useState } from 'react'
import { ChipInput, ChipSelect } from '@/components/emcn'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  parseDuration,
  SV_DURATION_UNITS,
  type SvDurationUnit,
  splitDuration,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/expr/duration'
import { useExternalEditKey } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/use-external-edit-key'

interface DurationFieldProps {
  initialMs: number | null
  min: number
  required: boolean
  disabled: boolean
  onCommit: (ms: number | null) => void
}

/** Draft text + unit; remounted by the parent (`key`) when the stored value changes elsewhere. */
function DurationField({ initialMs, min, required, disabled, onCommit }: DurationFieldProps) {
  const initial =
    initialMs === null ? { value: '', unit: 'ms' as SvDurationUnit } : splitDuration(initialMs)
  const [text, setText] = useState(initial.value)
  const [unit, setUnit] = useState<SvDurationUnit>(initial.unit)
  const [error, setError] = useState<string | undefined>()

  const commit = (nextText = text, nextUnit = unit) => {
    if (nextText.trim() === '') {
      setError(required ? 'A duration is required' : undefined)
      if (!required) onCommit(null)
      return
    }
    const parsed = parseDuration(nextText, nextUnit, min)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setError(undefined)
    onCommit(parsed.ms)
  }

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-1.5'>
        <ChipInput
          className='min-w-0 flex-1'
          inputMode='decimal'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          error={Boolean(error)}
          disabled={disabled}
          aria-label='Duration'
          placeholder='e.g. 500'
        />
        <ChipSelect
          options={SV_DURATION_UNITS.map((u) => ({ label: u.label, value: u.id }))}
          value={unit}
          onChange={(next) => {
            setUnit(next as SvDurationUnit)
            commit(text, next as SvDurationUnit)
          }}
          disabled={disabled}
        />
      </div>
      {error && (
        <p className='text-[var(--text-error)] text-caption' role='alert'>
          {error}
        </p>
      )}
    </div>
  )
}

interface SvDurationInputProps {
  blockId: string
  subBlockId: string
  /** Minimum in ms (BlockSpec `min`, e.g. 10 for timers). */
  min?: number
  required?: boolean
  isPreview?: boolean
  previewValue?: number | null
  disabled?: boolean
}

/**
 * SubBlock `sv-duration` (ADR-0011 §5, M03-T08): "500 ms", "2 s", "1 min" — stored as integer
 * milliseconds (ADR-0015 `duration(ms)`), never rounded.
 */
export function SvDurationInput({
  blockId,
  subBlockId,
  min = 0,
  required = false,
  isPreview = false,
  previewValue,
  disabled = false,
}: SvDurationInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<number | null>(blockId, subBlockId)
  const raw = isPreview ? previewValue : storeValue
  const ms = typeof raw === 'number' && Number.isInteger(raw) ? raw : null
  const { key, markCommitted } = useExternalEditKey(ms)
  return (
    <DurationField
      key={key}
      initialMs={ms}
      min={min}
      required={required}
      disabled={isPreview || disabled}
      onCommit={(next) => {
        markCommitted(next)
        setStoreValue(next)
      }}
    />
  )
}
