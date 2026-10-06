'use client'

import { useEffect, useRef } from 'react'
import { Badge } from '@/components/emcn'
import type { SvDiagnostic, SvGeneration } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { useSvGeneration } from '@/hooks/queries/sv-projects'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'

const STAGE_LABEL: Record<SvGeneration['stages'][number]['name'], string> = {
  ir: 'IR',
  codegen: 'Codegen',
  write: 'Write',
  deps: 'Dependencies',
  build: 'Build',
  'format-check': 'Format',
  test: 'Tests',
}

const STATE_VARIANT = {
  pending: 'gray',
  running: 'blue',
  passed: 'green',
  failed: 'red',
  skipped: 'gray-secondary',
} as const

const VERIFY: { key: keyof SvGeneration['verification']; label: string }[] = [
  { key: 'ir', label: 'IR' },
  { key: 'format', label: 'Format' },
  { key: 'compile', label: 'Compile' },
  { key: 'tests', label: 'Tests' },
]

interface BuildLogProps {
  /** The workflow open in the editor: its diagnostics focus the block. */
  workflowId: string | null
  workflowName: (workflowId: string) => string | undefined
  blockName: (blockId: string) => string | undefined
  onSelectBlock: (blockId: string, field?: string) => void
}

/**
 * Build log tab (M07-T18): stage progress, the verification of Appendix A, diagnostics mapped to
 * blocks (click to focus the block) and the streamed toolchain log.
 */
export function BuildLog({ workflowId, workflowName, blockName, onSelectBlock }: BuildLogProps) {
  const projectId = useSvSynCodeStore((s) => s.projectId)
  const generationId = useSvSynCodeStore((s) => s.generationId)
  const lines = useSvSynCodeStore((s) => s.lines)
  const { data: generation } = useSvGeneration(projectId ?? undefined, generationId ?? undefined)
  const logRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = logRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines])

  if (!generationId) {
    return (
      <div className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'>
        Press SynCode to generate, build and test the vehicle app
      </div>
    )
  }

  const describe = (d: SvDiagnostic) => {
    const where =
      d.workflowId && d.workflowId !== workflowId
        ? (workflowName(d.workflowId) ?? d.workflowId)
        : d.blockId
          ? (blockName(d.blockId) ?? d.blockId)
          : undefined
    return where ? `${where}: ${d.message}` : d.message
  }

  return (
    <div data-sv='build-log' className='flex min-h-0 flex-1'>
      <div className='flex w-[340px] shrink-0 flex-col gap-2 overflow-y-auto border-[var(--border)] border-r p-2'>
        <div className='flex flex-wrap gap-1' aria-label='Stages'>
          {(generation?.stages ?? []).map((s) => (
            <Badge
              key={s.name}
              size='sm'
              variant={STATE_VARIANT[s.state]}
              data-sv-stage={s.name}
              data-sv-state={s.state}
            >
              {STAGE_LABEL[s.name]}
            </Badge>
          ))}
        </div>
        {generation && (
          <div className='flex flex-wrap items-center gap-1' aria-label='Verification'>
            {VERIFY.map((v) => (
              <Badge
                key={v.key}
                size='sm'
                variant={STATE_VARIANT[generation.verification[v.key]]}
                data-sv-verify={v.key}
                data-sv-state={generation.verification[v.key]}
              >
                {`${v.label} ${generation.verification[v.key]}`}
              </Badge>
            ))}
          </div>
        )}
        {generation?.state === 'succeeded' && (
          <div data-sv='syncode-result' className='flex flex-col gap-1 text-[12px]'>
            <span className='text-[var(--text-primary)]'>SynCode passed</span>
            {generation.editor && (
              <a
                href={generation.editor.url}
                target='_blank'
                rel='noreferrer'
                data-sv='open-ide'
                className='text-[var(--text-link,var(--text-primary))] underline'
              >
                Open the project in the IDE
              </a>
            )}
          </div>
        )}
        {generation?.state === 'failed' && (
          <div data-sv='syncode-result' className='flex flex-col gap-1 text-[12px]'>
            <span className='text-[var(--text-error)]'>
              {`SynCode failed at ${generation.stage ? STAGE_LABEL[generation.stage] : 'a stage'}`}
            </span>
            <ul aria-label='SynCode diagnostics' className='flex flex-col gap-1'>
              {generation.diagnostics.map((d, i) => {
                const focusable = Boolean(
                  d.blockId && (!d.workflowId || d.workflowId === workflowId)
                )
                return (
                  <li key={`${d.code}-${i}`}>
                    <button
                      type='button'
                      data-sv-diagnostic={d.code}
                      disabled={!focusable}
                      onClick={() => d.blockId && onSelectBlock(d.blockId, d.field)}
                      className={cn(
                        'w-full rounded px-1 py-0.5 text-left',
                        focusable && 'hover:bg-[var(--surface-3)]'
                      )}
                    >
                      <span className='font-mono text-[11px] text-[var(--text-error)]'>
                        {d.code}
                      </span>{' '}
                      <span className='text-[var(--text-primary)]'>{describe(d)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
      <div
        ref={logRef}
        role='log'
        aria-label='Build log'
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className='min-w-0 flex-1 overflow-auto p-2 font-mono text-[11px] leading-[16px]'
      >
        {lines.map((l) => (
          <div
            key={l.seq}
            className={cn(
              'whitespace-pre-wrap break-all',
              l.level === 'error' || l.stream === 'stderr'
                ? 'text-[var(--text-error)]'
                : l.stream === 'system'
                  ? 'text-[var(--text-secondary)]'
                  : 'text-[var(--text-primary)]'
            )}
          >
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
