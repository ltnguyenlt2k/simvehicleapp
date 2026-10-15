'use client'

import { Code2 } from 'lucide-react'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'

/**
 * Open IDE (M09-T04, ADR-0028 §2): code-server on the project folder, same Velocitas toolchain as
 * SynCode. The studio only navigates there; it never calls the IDE.
 */
export function OpenIdeButton() {
  const { project } = useWorkflowProject()
  const url = project?.editor?.url
  return (
    <SvActionButton
      action='open-ide'
      label='Open IDE'
      icon={Code2}
      disabled={!url}
      onClick={() => url && window.open(url, '_blank', 'noopener,noreferrer')}
      title={
        url
          ? `Open ${project?.name} in the IDE (code-server, password from .env)`
          : project
            ? `${project.name} is not ready yet`
            : 'Press SynCode first: it creates the vehicle app of this workflow'
      }
    />
  )
}
