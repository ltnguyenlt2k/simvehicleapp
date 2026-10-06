'use client'

import { useMemo, useState } from 'react'
import { Button, ChipInput, ChipSelect, toast } from '@/components/emcn'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ProjectCard } from '@/app/workspace/[workspaceId]/vehicle-projects/components/project-card'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import { useCreateSvProject, useSvProjects } from '@/hooks/queries/sv-projects'
import { useWorkflows } from '@/hooks/queries/workflows'

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/

/** Folder name of the project from its name (`My Vehicle App` → `my-vehicle-app`). */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

interface VehicleProjectsProps {
  workspaceId: string
}

/**
 * Projects page (M07-T17): create a C++ vehicle-app project on a VSS release and choose the
 * workflows SynCode generates into it; each project shows its generated files (M07-T19).
 */
export function VehicleProjects({ workspaceId }: VehicleProjectsProps) {
  const { canEdit } = useUserPermissionsContext()
  const { data: projects, isLoading, error } = useSvProjects(workspaceId)
  const { data: workflows } = useWorkflows(workspaceId)
  const { data: catalog } = useSvCatalogReleases()
  const createProject = useCreateSvProject()
  const [name, setName] = useState('')
  const [slugEdit, setSlugEdit] = useState<string | null>(null)
  const [release, setRelease] = useState<string | null>(null)

  const releases = catalog?.releases ?? []
  const defaultRelease = releases.find((r) => r.default)?.release ?? releases[0]?.release
  const vssRelease = release ?? defaultRelease
  const slug = slugEdit ?? slugOf(name)
  const slugValid = SLUG.test(slug)
  const workflowList = useMemo(
    () => (workflows ?? []).map((w) => ({ id: w.id, name: w.name })),
    [workflows]
  )

  const onCreate = () => {
    if (!name.trim() || !slugValid || !vssRelease) return
    createProject.mutate(
      { workspaceId, name: name.trim(), slug, vssRelease, workflowIds: [] },
      {
        onSuccess: (project) => {
          toast.success(`Project ${project.name} created — preparing its folder`)
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
          <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>Vehicle projects</h1>
          <p className='text-[13px] text-[var(--text-secondary)]'>
            A project is a Velocitas C++ vehicle app. SynCode generates the workflows you assign
            into it, builds it with the toolchain and runs the generated tests.
          </p>
        </div>

        {canEdit && (
          <div
            data-sv='project-create'
            className='flex flex-wrap items-end gap-2 rounded-lg border border-[var(--border)] p-3'
          >
            <div className='flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>Name</span>
              <ChipInput
                aria-label='Project name'
                value={name}
                placeholder='Hazard lights app'
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className='flex min-w-[180px] flex-col gap-1 text-[12px] text-[var(--text-secondary)]'>
              <span>Folder</span>
              <ChipInput
                aria-label='Project folder'
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
                value='cpp'
                options={[{ label: 'C++', value: 'cpp' }]}
              />
            </div>
            <Button
              variant='primary'
              data-sv='project-create-submit'
              disabled={!name.trim() || !slugValid || !vssRelease || createProject.isPending}
              onClick={onCreate}
            >
              {createProject.isPending ? 'Creating…' : 'Create project'}
            </Button>
          </div>
        )}

        {error ? (
          <p className='text-[13px] text-[var(--text-error)]'>
            Projects are unavailable right now — {error.message}
          </p>
        ) : isLoading ? (
          <p className='text-[13px] text-[var(--text-muted)]'>Loading projects…</p>
        ) : !projects?.length ? (
          <p className='text-[13px] text-[var(--text-muted)]'>
            No vehicle projects yet. Create one, assign workflows, then press SynCode in the
            workflow editor.
          </p>
        ) : (
          <div className='flex flex-col gap-3'>
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
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
