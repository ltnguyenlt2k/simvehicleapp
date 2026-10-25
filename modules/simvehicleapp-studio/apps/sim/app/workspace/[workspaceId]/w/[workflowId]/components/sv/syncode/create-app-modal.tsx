'use client'

import { useState } from 'react'
import { generateShortId } from '@sim/utils/id'
import { useRouter } from 'next/navigation'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import { isApiClientError } from '@/lib/api/client/errors'
import type { SvProject } from '@/lib/api/contracts/sv'
import { appSlugWithSuffix, freeAppSlug } from '@/lib/sv/app-slug'
import {
  installedLanguages,
  SV_RUNTIMES,
  type SvLanguage,
  type SvRuntime,
  wasmAvailable,
} from '@/lib/sv/languages'
import { toastSvError } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/capacity-toast'
import { useCreateSvProject, useUpdateSvProjectWorkflows } from '@/hooks/queries/sv-projects'
import { useSvSystemStatus } from '@/hooks/queries/sv-system'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

const NEW_APP = 'new'

const LANGUAGE: Record<string, string> = { cpp: 'C++', python: 'Python', rust: 'Rust' }

/** A 409 without diagnostics on create is a folder name another workspace already uses (a quota has diagnostics). */
function isSlugTaken(error: unknown): boolean {
  if (!isApiClientError(error) || error.status !== 409) return false
  return !(error.body as { diagnostics?: unknown } | null)?.diagnostics
}

interface CreateAppModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workflowId: string
  workflowName: string
  /** The workflow's VSS release: the app must use the same one. */
  vssRelease: string
  /** Vehicle apps of the workspace. */
  projects: SvProject[]
}

/**
 * SynCode on a workflow that is in no vehicle app yet (ADR-0053 §A, M16-T05): the user names a new app (or picks an
 * existing app on the same VSS release), the app is prepared, and SynCode starts by itself once it is ready. The
 * folder name, release and assignment are derived, so nobody has to visit the Vehicle apps page first.
 */
export function CreateAppModal({
  open,
  onOpenChange,
  workspaceId,
  workflowId,
  workflowName,
  vssRelease,
  projects,
}: CreateAppModalProps) {
  const router = useRouter()
  const create = useCreateSvProject()
  const assign = useUpdateSvProjectWorkflows()
  const { data: system } = useSvSystemStatus()
  const [target, setTarget] = useState(NEW_APP)
  const [name, setName] = useState(workflowName)
  const [language, setLanguage] = useState<SvLanguage>('cpp')
  const languages = installedLanguages(system?.services)
  const [runtime, setRuntime] = useState<SvRuntime>('velocitas')
  const canWasm = wasmAvailable(system?.services, language)
  const sameRelease = projects.filter(
    (p) =>
      p.vssRelease === vssRelease &&
      p.status !== 'failed' &&
      !p.workflows.some((w) => w.enabled && w.simWorkflowId === workflowId)
  )
  const pending = create.isPending || assign.isPending
  const isNew = target === NEW_APP
  const openVehicleApps = () => router.push(`/workspace/${workspaceId}/vehicle-projects`)

  const started = (project: SvProject, verb: string) => {
    useSvSynCodeStore.getState().requestAutoSynCode(project.id)
    toast.success(
      project.status === 'ready'
        ? `${verb} ${project.name} — SynCode starts now`
        : `${verb} ${project.name} — preparing it (the first time takes a few minutes); SynCode starts when it is ready`
    )
    onOpenChange(false)
  }

  const createApp = async () => {
    const slug = freeAppSlug(
      name,
      projects.map((p) => p.slug)
    )
    const body = {
      workspaceId,
      name: name.trim(),
      slug,
      vssRelease,
      workflowIds: [workflowId],
      language,
      ...(canWasm && runtime === 'wasm' ? { target: 'wasm' as const } : {}),
    }
    try {
      return await create.mutateAsync(body)
    } catch (error) {
      if (!isSlugTaken(error)) throw error
      return create.mutateAsync({ ...body, slug: appSlugWithSuffix(slug, generateShortId(6)) })
    }
  }

  const onConfirm = async () => {
    try {
      if (isNew) {
        started(await createApp(), 'Created')
        return
      }
      const app = sameRelease.find((p) => p.id === target)
      if (!app) return
      const ids = app.workflows.filter((w) => w.enabled).map((w) => w.simWorkflowId)
      started(
        await assign.mutateAsync({ projectId: app.id, workflowIds: [...ids, workflowId] }),
        'Added to'
      )
    } catch (error) {
      toastSvError(error as Error, isNew ? 'Create app' : 'Add to app', openVehicleApps)
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create a vehicle app'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Create a vehicle app</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-small'>
          SynCode turns this workflow into a vehicle app: a program that runs on the vehicle, built
          and tested here. Choose where it goes.
        </p>
        <ChipModalField
          type='dropdown'
          title='App'
          value={target}
          onChange={setTarget}
          options={[
            { value: NEW_APP, label: 'A new vehicle app' },
            ...sameRelease.map((p) => ({
              value: p.id,
              label: `Add to ${p.name} (${LANGUAGE[p.language] ?? p.language})`,
            })),
          ]}
          hint={
            sameRelease.length === 0 && projects.length > 0
              ? `Existing apps use another VSS release than this workflow (${vssRelease}).`
              : undefined
          }
        />
        {isNew && (
          <ChipModalField
            type='input'
            title='Name'
            value={name}
            onChange={setName}
            placeholder='Hazard lights app'
            maxLength={200}
            required
            onSubmit={onConfirm}
          />
        )}
        {isNew && (
          <ChipModalField
            type='dropdown'
            title='Language'
            value={language}
            onChange={(v) => setLanguage(v as SvLanguage)}
            options={languages.map((l) => ({ value: l.value, label: l.label }))}
          />
        )}
        {isNew && canWasm && (
          <ChipModalField
            type='dropdown'
            title='Runtime'
            hint='WebAssembly: one small module run by sv-wasm-host, sandboxed with memory and time limits.'
            value={runtime}
            onChange={(v) => setRuntime(v as SvRuntime)}
            options={SV_RUNTIMES.map((r) => ({ value: r.value, label: r.label }))}
          />
        )}
        <ChipModalField
          type='custom'
          title='VSS release'
          hint='The release of this workflow; an app has one release.'
        >
          <span data-sv='create-app-release' className='text-[var(--text-primary)] text-small'>
            {vssRelease}
          </span>
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={pending}
        primaryAction={{
          label: pending
            ? isNew
              ? 'Creating...'
              : 'Adding...'
            : isNew
              ? 'Create and SynCode'
              : 'Add and SynCode',
          onClick: onConfirm,
          disabled: pending || (isNew && !name.trim()),
        }}
      />
    </ChipModal>
  )
}
