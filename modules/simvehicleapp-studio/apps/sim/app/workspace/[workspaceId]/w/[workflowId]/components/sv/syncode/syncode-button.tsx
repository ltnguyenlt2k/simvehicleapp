'use client'

import { useEffect } from 'react'
import { Hammer } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { toast } from '@/components/emcn'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import { toastSvError } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/capacity-toast'
import { CreateAppModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/create-app-modal'
import { useSynCodeFollow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-syncode-follow'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { useSvWorkflowRelease } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release'
import { useSvCatalogReleases } from '@/hooks/queries/sv-catalog'
import { useStartSvGeneration, useSvProjects } from '@/hooks/queries/sv-projects'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/** Blocks of the WorkflowGraph JSON on the canvas (0 when it cannot be read). */
function blockCount(graphJson: string): number {
  try {
    return (JSON.parse(graphJson) as { blocks?: unknown[] }).blocks?.length ?? 0
  } catch {
    return 0
  }
}

/**
 * SynCode (M07-T18): generates, builds and tests the vehicle app the open workflow belongs to. The
 * graph on the canvas is sent with the request (it may be newer than the saved one); the other
 * workflows of the app come from their saved state. A workflow in no app yet opens the dialog that
 * creates one (or adds it to an app on the same release); SynCode then starts by itself once the app
 * is ready (ADR-0053 §A, M16-T05).
 */
interface SynCodeButtonProps {
  /** SynCode is the sensible next step (ADR-0054). */
  primary?: boolean
}

export function SynCodeButton({ primary = false }: SynCodeButtonProps) {
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params?.workspaceId
  const router = useRouter()
  const graphJson = useSvLintStore((s) => s.graphJson)
  const { project, workflowId } = useWorkflowProject()
  const { data: projects } = useSvProjects(workspaceId)
  const { data: workflowMap } = useWorkflowMap(workspaceId)
  const { data: catalog } = useSvCatalogReleases()
  const pinnedRelease = useSvWorkflowRelease()
  const autoProjectId = useSvSynCodeStore((s) => s.autoSynCodeProjectId)
  const creating = useSvSynCodeStore((s) => s.createAppOpen)
  // The canvas holds this workflow (an editor graph read during loading is empty — found by the M8 live E2E).
  const loaded = useWorkflowRegistry(
    (s) => s.hydration.phase === 'ready' && s.hydration.workflowId === workflowId
  )
  const start = useStartSvGeneration()
  const { generation, running } = useSynCodeFollow()
  const busy = running || start.isPending
  const releases = catalog?.releases ?? []
  const vssRelease =
    pinnedRelease ?? releases.find((r) => r.default)?.release ?? releases[0]?.release
  const preparing = Boolean(
    project && autoProjectId === project.id && project.status === 'creating'
  )
  const openVehicleApps = () => router.push(`/workspace/${workspaceId}/vehicle-projects`)

  const onSynCode = () => {
    const { graphJson: current, workflowId: wf, issues, showProblems } = useSvLintStore.getState()
    if (!project || !current || !wf) return
    if (issues.length > 0) {
      // Parts of the canvas the graph could not carry: generating would drop them.
      showProblems()
      toast.error(`SynCode: fix ${issues.length} problem${issues.length === 1 ? '' : 's'} first`)
      return
    }
    // The editor's graph may hold edits not saved yet; an empty one is never trusted over the saved state.
    const open =
      blockCount(current) > 0
        ? { workflowId: wf, graph: JSON.parse(current) as Record<string, unknown> }
        : undefined
    start.mutate(
      { projectId: project.id, body: open ? { open } : {} },
      {
        onSuccess: (generation) =>
          useSvSynCodeStore.getState().start(project.id, generation.id, current),
        onError: (e) => toastSvError(e, 'SynCode', openVehicleApps),
      }
    )
  }

  /** The app created from the dialog became ready (or failed): SynCode it once. */
  useEffect(() => {
    if (!project || autoProjectId !== project.id || !loaded) return
    if (project.status === 'ready') {
      useSvSynCodeStore.getState().clearAutoSynCode()
      onSynCode()
    } else if (project.status === 'failed') {
      useSvSynCodeStore.getState().clearAutoSynCode()
      toast.error(
        `${project.name} could not be prepared${project.statusMessage ? `: ${project.statusMessage}` : ''}. Repair it in Vehicle apps.`,
        { action: { label: 'Open Vehicle apps', onClick: openVehicleApps } }
      )
    }
  }, [project?.id, project?.status, autoProjectId, loaded])

  const title = !project
    ? 'Create a vehicle app for this workflow, then generate, build and test it'
    : !loaded
      ? 'Loading the workflow…'
      : preparing
        ? `Preparing ${project.name}: SynCode starts when it is ready`
        : project.status !== 'ready'
          ? `Project ${project.name} is ${project.status === 'creating' ? 'still being prepared' : 'not ready'}`
          : `Generate, build and test ${project.name}`

  const setCreating = (open: boolean) => useSvSynCodeStore.getState().setCreateAppOpen(open)
  return (
    <>
      <SvActionButton
        action='syncode'
        label='SynCode'
        icon={Hammer}
        busy={busy || preparing}
        busyLabel={preparing ? 'Preparing app…' : 'SynCode…'}
        outcome={
          generation?.state === 'succeeded'
            ? 'passed'
            : generation?.state === 'failed'
              ? 'failed'
              : null
        }
        primary={primary}
        disabled={
          // Without an app, creation is offered only once the app list is known (else a slow list would open the
          // dialog for a workflow that already has an app).
          (project
            ? project.status !== 'ready'
            : !workspaceId || !workflowId || !vssRelease || projects === undefined) ||
          !graphJson ||
          !loaded
        }
        onClick={project ? onSynCode : () => setCreating(true)}
        title={title}
      />
      {creating && workspaceId && workflowId && vssRelease && (
        <CreateAppModal
          open={creating}
          onOpenChange={setCreating}
          workspaceId={workspaceId}
          workflowId={workflowId}
          workflowName={workflowMap?.[workflowId]?.name ?? 'Vehicle app'}
          vssRelease={vssRelease}
          projects={projects ?? []}
        />
      )}
    </>
  )
}
