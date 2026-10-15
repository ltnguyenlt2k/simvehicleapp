'use client'

import { Boxes, Check, ChevronDown } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { useWorkflowProject } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode/use-workflow-project'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

const LANGUAGE: Record<string, string> = { cpp: 'C++', python: 'Python', rust: 'Rust' }

/**
 * The vehicle app SynCode, Run, Open IDE and Export act on (ADR-0054): its name, language and VSS release. The menu
 * switches between the apps the workflow belongs to, creates another one, or opens Vehicle apps.
 */
export function SvAppChip() {
  const params = useParams<{ workspaceId?: string }>()
  const router = useRouter()
  const { project, candidates } = useWorkflowProject()
  const label = project
    ? `${project.name} · ${LANGUAGE[project.language] ?? project.language} · ${project.vssRelease}`
    : 'No vehicle app'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          data-sv='app-chip'
          data-sv-project={project?.slug}
          className='min-w-0 max-w-[280px] gap-1.5'
          title='The vehicle app SynCode, Run, Open IDE and Export use'
        >
          <Boxes aria-hidden className='size-[14px] shrink-0' />
          <span className='truncate'>{label}</span>
          <ChevronDown aria-hidden className='size-[12px] shrink-0' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' sideOffset={4}>
        {candidates.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() => useSvSynCodeStore.getState().selectProject(p.id)}
          >
            <Check
              aria-hidden
              className={p.id === project?.id ? 'size-[14px]' : 'size-[14px] opacity-0'}
            />
            {p.name}
          </DropdownMenuItem>
        ))}
        {candidates.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          data-sv='app-chip-create'
          onSelect={() => useSvSynCodeStore.getState().setCreateAppOpen(true)}
        >
          {project ? 'Add this workflow to another app…' : 'Create a vehicle app…'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => router.push(`/workspace/${params?.workspaceId}/vehicle-projects`)}
        >
          Manage vehicle apps
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
