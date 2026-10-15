'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, ChipInput, ChipSelect, toast } from '@/components/emcn'
import { appSlugOf, SV_APP_SLUG } from '@/lib/sv/app-slug'
import { installedLanguages, type SvLanguage } from '@/lib/sv/languages'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { CapacityBar } from '@/app/workspace/[workspaceId]/vehicle-projects/components/capacity-bar'
import { ProjectCard } from '@/app/workspace/[workspaceId]/vehicle-projects/components/project-card'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import { useCreateSvProject, useSvProjects, useSvReconcile } from '@/hooks/queries/sv-projects'
import { useSvSystemStatus } from '@/hooks/queries/sv-system'
import { useWorkflows } from '@/hooks/queries/workflows'

interface VehicleProjectsProps {
  workspaceId: string
}

/**
 * Vehicle apps page (M07-T17, M16-T04): create a C++ or Python (ADR-0040) vehicle app on a VSS release and choose
 * the workflows SynCode generates into it; each app shows its generated files (M07-T19), disk usage and lifecycle
 * actions, and the page shows the workspace's app quota and the host's free disk (ADR-0053).
 */
export function VehicleProjects({ workspaceId }: VehicleProjectsProps) {
  const { canEdit } = useUserPermissionsContext()
  const { data: projects, isLoading, error } = useSvProjects(workspaceId)
  const { data: workflows } = useWorkflows(workspaceId)
  const { data: catalog } = useSvCatalogReleases()
  const createProject = useCreateSvProject()
  const { mutate: reconcileApps } = useSvReconcile()
  const [name, setName] = useState('')
  const [slugEdit, setSlugEdit] = useState<string | null>(null)
  const [release, setRelease] = useState<string | null>(null)
  const [language, setLanguage] = useState<SvLanguage>('cpp')
  const { data: system } = useSvSystemStatus()
  const languages = installedLanguages(system?.services)

  const releases = catalog?.releases ?? []
  const defaultRelease = releases.find((r) => r.default)?.release ?? releases[0]?.release
  const vssRelease = release ?? defaultRelease
  const slug = slugEdit ?? appSlugOf(name)
  const slugValid = SV_APP_SLUG.test(slug)
  const workflowList = useMemo(
    () => (workflows ?? []).map((w) => ({ id: w.id, name: w.name })),
    [workflows]
  )

  /** Drops apps of deleted workspaces and links to vanished apps; the server runs it at most once an hour. */
  useEffect(() => {
    reconcileApps()
  }, [reconcileApps])

  const onCreate = () => {
    if (!name.trim() || !slugValid || !vssRelease) return
    createProject.mutate(
      { workspaceId, name: name.trim(), slug, vssRelease, workflowIds: [], language },
      {
        onSuccess: (project) => {
          toast.success(`Vehicle app ${project.name} created — preparing its folder`)
          setName('')
          setSlugEdit(null)
        },
        onError: (e) => toast.error(e.message),
      }
    )
  }

  return (
    <div data-sv='projects-page' className='flex h-full flex-col overflow-y-auto bg-[var(--bg)]'>
      <div className='mx-auto flex w-full max-w-[960px] flex-col gap-6 px-6 py-8'>
        <div className='flex flex-col gap-1'>
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Vehicle apps</h1>
          <p className='text-[13px] text-[var(--text-secondary)]'>
            A vehicle app is the C++ or Python program your workflows become. SynCode generates the
            workflows you tick into it, builds it and runs its tests; Run starts it against the
            vehicle simulator. Clean or delete apps you no longer need to free disk space.
          </p>
        </div>

        <CapacityBar workspaceId={workspaceId} />

        {canEdit && (
          <div
            data-sv='project-create'
            className='flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3'
          >
            <div className='flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>Name</span>
              <ChipInput
                aria-label='App name'
                value={name}
                placeholder='Hazard lights app'
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className='flex min-w-[180px] flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>Folder</span>
              <ChipInput
                aria-label='App folder'
                value={slug}
                error={slug.length > 0 && !slugValid}
                placeholder='hazard-lights-app'
                onChange={(e) => setSlugEdit(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>VSS release</span>
              <ChipSelect
                aria-label='VSS release'
                value={vssRelease}
                onChange={setRelease}
                options={releases.map((r) => ({ label: r.release, value: r.release }))}
              />
            </div>
            <div className='flex flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>Language</span>
              <ChipSelect
                aria-label='Language'
                value={language}
                onChange={(v) => setLanguage(v as SvLanguage)}
                options={languages.map((l) => ({ label: l.label, value: l.value }))}
              />
            </div>
            <Button
              variant='primary'
              data-sv='project-create-submit'
              disabled={!name.trim() || !slugValid || !vssRelease || createProject.isPending}
              onClick={onCreate}
            >
              {createProject.isPending ? 'Creating…' : 'Create app'}
            </Button>
          </div>
        )}

        {error ? (
          <p className='text-[13px] text-[var(--text-error)]'>
            Vehicle apps are unavailable right now — {error.message}
          </p>
        ) : isLoading ? (
          <p className='text-[13px] text-[var(--text-muted)]'>Loading vehicle apps…</p>
        ) : !projects?.length ? (
          <p className='text-[13px] text-[var(--text-muted)]'>
            No vehicle apps yet. Create one, tick the workflows it contains, then press SynCode in
            the workflow editor.
          </p>
        ) : (
          <div className='flex flex-col gap-3'>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                workspaceId={workspaceId}
                workflows={workflowList}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
