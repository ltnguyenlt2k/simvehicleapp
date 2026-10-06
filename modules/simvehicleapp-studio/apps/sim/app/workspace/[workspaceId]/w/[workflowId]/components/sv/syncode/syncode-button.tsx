'use client'

import { Button, ChipSelect, toast } from '@/components/emcn'
import { useSynCodeFollow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-syncode-follow'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { useStartSvGeneration } from '@/hooks/queries/sv-projects'
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
 * SynCode (M07-T18): generates, builds and tests the project the open workflow belongs to. The
 * graph on the canvas is sent with the request (it may be newer than the saved one); the other
 * workflows of the project come from their saved state.
 */
export function SynCodeButton() {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const { project, candidates, workflowId } = useWorkflowProject()
  // The canvas holds this workflow (an editor graph read during loading is empty — found by the M8 live E2E).
  const loaded = useWorkflowRegistry(
    (s) => s.hydration.phase === 'ready' && s.hydration.workflowId === workflowId
  )
  const start = useStartSvGeneration()
  const { running } = useSynCodeFollow()
  const busy = running || start.isPending

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
        onSuccess: (generation) => useSvSynCodeStore.getState().start(project.id, generation.id),
        onError: (e) => toast.error(`SynCode: ${e.message}`),
      }
    )
  }

  const title = !project
    ? 'Add this workflow to a vehicle project first (Vehicle projects page)'
    : !loaded
      ? 'Loading the workflow…'
      : project.status !== 'ready'
        ? `Project ${project.name} is ${project.status === 'creating' ? 'still being prepared' : 'not ready'}`
        : `Generate, build and test ${project.name}`

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        data-sv-action='syncode'
        aria-busy={busy || undefined}
        disabled={!project || project.status !== 'ready' || busy || !graphJson || !loaded}
        onClick={onSynCode}
        title={title}
      >
        {busy ? 'SynCode…' : 'SynCode'}
      </Button>
      {candidates.length > 1 && (
        <ChipSelect
          aria-label='SynCode project'
          value={project?.id}
          onChange={(id) => useSvSynCodeStore.getState().selectProject(id)}
          options={candidates.map((p) => ({ label: p.name, value: p.id }))}
        />
      )}
    </>
  )
}
