'use client'

import { useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import {
  Button,
  ChipConfirmModal,
  ChipModalField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@/components/emcn'
import type { SvProject } from '@/lib/api/contracts/sv'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import {
  useCleanSvProject,
  useDeleteSvProject,
  useRepairSvProject,
} from '@/hooks/queries/sv-projects'

type Confirm = 'clean' | 'delete' | null

interface AppActionsProps {
  project: SvProject
  workspaceId: string
  /** What clean would free, when measured. */
  buildBytes?: number
}

/**
 * Lifecycle actions of a vehicle app (ADR-0053 §A): Repair (a failed app is prepared again), Clean (build outputs
 * removed, the next SynCode rebuilds) and Delete (folder, caches and history removed; the user types the app's name).
 */
export function AppActions({ project, workspaceId, buildBytes }: AppActionsProps) {
  const repair = useRepairSvProject()
  const clean = useCleanSvProject()
  const remove = useDeleteSvProject()
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [typed, setTyped] = useState('')
  const vars = { projectId: project.id, workspaceId }

  const close = (open: boolean) => {
    if (open) return
    setConfirm(null)
    setTyped('')
  }

  const onRepair = () =>
    repair.mutate(vars, {
      onSuccess: () => toast.success(`Preparing ${project.name} again`),
      onError: (e) => toast.error(e.message),
    })

  const onClean = () =>
    clean.mutate(vars, {
      onSuccess: ({ freedBytes }) => {
        toast.success(`${project.name} cleaned — ${formatFileSize(freedBytes)} freed`)
        close(false)
      },
      onError: (e) => toast.error(e.message),
    })

  const onDelete = () =>
    remove.mutate(vars, {
      onSuccess: () => {
        toast.success(`${project.name} deleted`)
        close(false)
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='sm'
            data-sv='project-actions'
            aria-label={`Actions for ${project.name}`}
          >
            <MoreHorizontal className='size-[14px]' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' sideOffset={4}>
          {project.status === 'failed' && (
            <DropdownMenuItem
              data-sv='project-repair'
              disabled={repair.isPending}
              onSelect={onRepair}
            >
              Repair
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            data-sv='project-clean'
            disabled={project.status !== 'ready'}
            onSelect={() => setConfirm('clean')}
          >
            Clean build outputs
          </DropdownMenuItem>
          <DropdownMenuItem data-sv='project-delete' onSelect={() => setConfirm('delete')}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChipConfirmModal
        open={confirm === 'clean'}
        onOpenChange={close}
        title={`Clean ${project.name}`}
        text={[
          'Removes the build outputs',
          buildBytes ? ` (${formatFileSize(buildBytes)})` : '',
          '. Sources and workflows stay; the next SynCode reinstalls dependencies and rebuilds, which takes longer.',
        ]}
        confirm={{
          label: 'Clean',
          variant: 'primary',
          onClick: onClean,
          pending: clean.isPending,
          pendingLabel: 'Cleaning...',
        }}
      />

      <ChipConfirmModal
        open={confirm === 'delete'}
        onOpenChange={close}
        title={`Delete ${project.name}`}
        text={[
          'Deletes the app folder, its build caches and its SynCode history. ',
          { text: 'This action cannot be undone.', error: true },
          ' Workflows are not deleted.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: onDelete,
          pending: remove.isPending,
          pendingLabel: 'Deleting...',
          disabled: typed !== project.name,
        }}
      >
        <ChipModalField
          type='input'
          title={
            <span>
              Type&nbsp;
              <span className='font-medium text-[var(--text-primary)]'>{project.name}</span>
              &nbsp;to confirm
            </span>
          }
          value={typed}
          onChange={setTyped}
          placeholder={project.name}
        />
      </ChipConfirmModal>
    </>
  )
}
