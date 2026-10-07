'use client'

import { Button } from '@/components/emcn'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'

/**
 * Open IDE (M09-T04, ADR-0028 §2): code-server on the project folder, same Velocitas toolchain as
 * SynCode. The studio only navigates there; it never calls the IDE.
 */
export function OpenIdeButton() {
  const { project } = useWorkflowProject()
  const url = project?.editor?.url
  return (
    <Button
      variant='ghost'
      size='sm'
      data-sv-action='open-ide'
      disabled={!url}
      onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
      title={
        url
          ? `Open ${project?.name} in the IDE (code-server, password from .env)`
          : project
            ? `${project.name} is not ready yet`
            : 'Add this workflow to a vehicle project first (Vehicle projects page)'
      }
    >
      Open IDE
    </Button>
  )
}
