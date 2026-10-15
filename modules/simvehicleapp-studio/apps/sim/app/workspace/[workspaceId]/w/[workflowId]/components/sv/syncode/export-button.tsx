'use client'

import { Download } from 'lucide-react'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
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
    <SvActionButton
      action='export'
      label='Export'
      icon={Download}
      disabled={!ready}
      onClick={() =>
        project &&
        window.location.assign(`/api/sv/projects/${encodeURIComponent(project.id)}/export`)
      }
      title={
        !project
          ? 'Press SynCode first: it creates the vehicle app of this workflow'
          : ready
            ? `Download ${project.name} as a zip`
            : `${project.name} is not ready yet`
      }
    />
  )
}
