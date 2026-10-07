'use client'

import { Button } from '@/components/emcn'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'

/**
 * Export (M09-T06): downloads the project zip — buildable outside SimVehicleApp with the template's
 * tooling, with the workflows it was generated from (`.simvehicleapp/workflows/*.graph.json`). The
 * route answers with an attachment, so navigating to it downloads without leaving the editor.
 */
export function ExportButton() {
  const { project } = useWorkflowProject()
  const ready = project?.status === 'ready'
  return (
    <Button
      variant='ghost'
      size='sm'
      data-sv-action='export'
      disabled={!ready}
      onClick={() =>
        project &&
        window.location.assign(`/api/sv/projects/${encodeURIComponent(project.id)}/export`)
      }
      title={
        !project
          ? 'Add this workflow to a vehicle project first (Vehicle projects page)'
          : ready
            ? `Download ${project.name} as a zip`
            : `${project.name} is not ready yet`
      }
    >
      Export
    </Button>
  )
}
