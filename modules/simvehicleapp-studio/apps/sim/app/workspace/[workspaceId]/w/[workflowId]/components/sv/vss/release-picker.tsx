'use client'

import { ChipSelect, toast } from '@/components/emcn'
import { useSvT } from '@/lib/sv/i18n/locale-provider'
import { useSvWorkflowDomain } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import { useSvRobotCatalog } from '@/hooks/queries/sv-robotics'
import {
  useSvWorkflowSettings,
  useUpdateSvWorkflowSettings,
} from '@/hooks/queries/sv-workflow-settings'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Option value of the RSS catalog (a VSS release is `v4.0`, `v4.2`…). */
const RSS_OPTION = 'rss'

interface SvReleasePickerProps {
  workflowId?: string
  disabled?: boolean
}

/**
 * Signal catalog of the workflow (M02-T11, ADR-0068 Notes 2026-11-01): a VSS release for a vehicle workflow, or the
 * RSS catalog of the robot for a robot workflow. The palette and the signal tree follow the choice; changing the
 * family is refused while the canvas still holds blocks of the other one.
 */
export function SvReleasePicker({ workflowId, disabled = false }: SvReleasePickerProps) {
  const t = useSvT()
  const { data: catalog } = useSvCatalogReleases()
  const { data: rss } = useSvRobotCatalog(true)
  const { data: settings } = useSvWorkflowSettings(workflowId)
  const domain = useSvWorkflowDomain()
  const update = useUpdateSvWorkflowSettings()

  const releases = catalog?.releases ?? []
  const defaultRelease = releases.find((r) => r.default)?.release
  const current = domain === 'robot' ? RSS_OPTION : (settings?.vssRelease ?? defaultRelease)
  const options = [
    ...releases.map((r) => ({
      label: r.default
        ? t('catalog.vssDefault', { release: r.release })
        : t('catalog.vss', { release: r.release }),
      value: r.release,
    })),
    ...(rss
      ? [{ label: t('catalog.rss', { version: rss.rss, profile: rss.profile }), value: RSS_OPTION }]
      : []),
  ]

  const onChange = (value: string) => {
    if (!workflowId || value === current) return
    const toRobot = value === RSS_OPTION
    const other = Object.values(useWorkflowStore.getState().blocks).some((b) =>
      toRobot ? b.type.startsWith('sv_') : b.type.startsWith('rf_')
    )
    if (other) {
      toast.error(t(toRobot ? 'catalog.removeVehicleBlocks' : 'catalog.removeRobotBlocks'))
      return
    }
    update.mutate(
      toRobot
        ? { workflowId, domain: 'robot' }
        : { workflowId, domain: 'vehicle', vssRelease: value }
    )
  }

  return (
    <div className='flex items-center gap-2' data-sv='vss-release-picker' data-sv-domain={domain}>
      <span className='shrink-0 text-[var(--text-muted)] text-caption'>{t('catalog.label')}</span>
      <ChipSelect
        options={options}
        value={current}
        onChange={onChange}
        placeholder={t('catalog.placeholder')}
        disabled={disabled || !workflowId || options.length === 0 || update.isPending}
      />
      {update.isError && (
        <span className='text-[var(--text-error)] text-caption' role='alert'>
          {update.error.message}
        </span>
      )}
    </div>
  )
}
