import { Button } from '@/components/emcn'
import { SV_ACTIONS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'

/** Workflow actions of the vehicle editor; each is disabled until its milestone ships. */
export function SvActionBar() {
  return (
    <div
      role='toolbar'
      aria-label='Vehicle app actions'
      data-sv='action-bar'
      className='flex h-[36px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b bg-[var(--surface-1)] px-2'
    >
      {SV_ACTIONS.map((action) => (
        <Button
          key={action.id}
          variant='ghost'
          size='sm'
          disabled
          data-sv-action={action.id}
          title={`${action.label} — available in ${action.milestone}`}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}
