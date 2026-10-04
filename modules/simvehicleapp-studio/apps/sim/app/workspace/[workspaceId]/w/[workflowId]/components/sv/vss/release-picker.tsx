'use client'

import { ChipSelect } from '@/components/emcn'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import {
  useSvWorkflowSettings,
  useUpdateSvWorkflowSettings,
} from '@/hooks/queries/sv-workflow-settings'

interface SvReleasePickerProps {
  workflowId?: string
  disabled?: boolean
}

/**
 * Minimal project setting (M02-T11): the VSS release this workflow targets. Changing it reloads the
 * Vehicle tree from vss-catalog — no studio rebuild (ADR-0011 Verification).
 */
export function SvReleasePicker({ workflowId, disabled = false }: SvReleasePickerProps) {
  const { data: catalog } = useSvCatalogReleases()
  const { data: settings } = useSvWorkflowSettings(workflowId)
  const update = useUpdateSvWorkflowSettings()

  const releases = catalog?.releases ?? []
  const defaultRelease = releases.find((r) => r.default)?.release
  const current = settings?.vssRelease ?? defaultRelease

  return (
    <div className='flex items-center gap-2' data-sv='vss-release-picker'>
      <span className='shrink-0 text-[var(--text-muted)] text-caption'>VSS</span>
      <ChipSelect
        options={releases.map((r) => ({
          label: r.default ? `${r.release} (default)` : r.release,
          value: r.release,
        }))}
        value={current}
        onChange={(vssRelease) => {
          if (workflowId && vssRelease !== current) update.mutate({ workflowId, vssRelease })
        }}
        placeholder='Release'
        disabled={disabled || !workflowId || releases.length === 0 || update.isPending}
      />
      {update.isError && (
        <span className='text-[var(--text-error)] text-caption' role='alert'>
          {update.error.message}
        </span>
      )}
    </div>
  )
}
