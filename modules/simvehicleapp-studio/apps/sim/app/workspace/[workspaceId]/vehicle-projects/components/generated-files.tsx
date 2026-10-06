'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { lineDiff } from '@/lib/sv/line-diff'
import { useSvProjectFile, useSvProjectFiles } from '@/hooks/queries/sv-projects'

interface GeneratedFilesProps {
  projectId: string
}

/**
 * Generated files viewer (M07-T19): the project tree (generated files first), one file read-only,
 * and its diff with the previous generation. Edits happen in the IDE, never here.
 */
export function GeneratedFiles({ projectId }: GeneratedFilesProps) {
  const { data, error, isLoading } = useSvProjectFiles(projectId)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState(false)
  const files = useMemo(
    () =>
      [...(data?.files ?? [])].sort(
        (a, b) =>
          Number(b.owned ?? false) - Number(a.owned ?? false) || a.path.localeCompare(b.path)
      ),
    [data]
  )
  const previous = useMemo(() => {
    const gens = data?.generations ?? []
    const at = data?.current ? gens.indexOf(data.current) : -1
    return at > 0 ? gens[at - 1] : undefined
  }, [data])

  if (error) {
    return (
      <p className='text-[12px] text-[var(--text-error)]'>Files are unavailable: {error.message}</p>
    )
  }
  if (isLoading) return <p className='text-[12px] text-[var(--text-muted)]'>Loading files…</p>

  return (
    <div
      data-sv='generated-files'
      className='flex h-[420px] min-h-0 rounded-md border border-[var(--border)]'
    >
      <ul
        aria-label='Project files'
        className='w-[280px] shrink-0 overflow-y-auto border-[var(--border)] border-r py-1 text-[12px]'
      >
        {files.map((f) => (
          <li key={f.path}>
            <button
              type='button'
              data-sv-file={f.path}
              onClick={() => setSelected(f.path)}
              className={cn(
                'w-full truncate px-2 py-0.5 text-left font-mono hover:bg-[var(--surface-3)]',
                f.path === selected && 'bg-[var(--surface-4)]',
                f.owned ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              )}
              title={f.owned ? `${f.path} (generated)` : f.path}
            >
              {f.path}
            </button>
          </li>
        ))}
      </ul>
      <div className='flex min-w-0 flex-1 flex-col'>
        {selected ? (
          <FileView
            projectId={projectId}
            path={selected}
            previous={previous}
            diff={diff}
            onToggleDiff={() => setDiff((v) => !v)}
          />
        ) : (
          <div className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'>
            {data?.current
              ? 'Select a file to view it'
              : 'Nothing generated yet — press SynCode in the workflow editor'}
          </div>
        )}
      </div>
    </div>
  )
}

interface FileViewProps {
  projectId: string
  path: string
  previous?: string
  diff: boolean
  onToggleDiff: () => void
}

function FileView({ projectId, path, previous, diff, onToggleDiff }: FileViewProps) {
  const current = useSvProjectFile(projectId, path)
  const before = useSvProjectFile(projectId, diff ? path : undefined, previous)
  const lines = useMemo(() => {
    if (!diff || !current.data || before.isLoading) return null
    return lineDiff(before.data?.content ?? '', current.data.content)
  }, [diff, current.data, before.data, before.isLoading])

  return (
    <>
      <div className='flex h-[32px] shrink-0 items-center gap-2 border-[var(--border)] border-b px-2'>
        <span className='truncate font-mono text-[12px] text-[var(--text-secondary)]'>{path}</span>
        <span className='text-[11px] text-[var(--text-muted)]'>read-only</span>
        <div className='ml-auto'>
          <Button
            variant={diff ? 'active' : 'ghost'}
            size='sm'
            data-sv='file-diff-toggle'
            disabled={!previous}
            title={previous ? 'Compare with the previous generation' : 'No previous generation'}
            onClick={onToggleDiff}
          >
            Diff with previous
          </Button>
        </div>
      </div>
      <pre
        data-sv='file-content'
        className='min-h-0 flex-1 overflow-auto whitespace-pre p-2 font-mono text-[12px] text-[var(--text-primary)]'
      >
        {current.error
          ? `Cannot show this file: ${current.error.message}`
          : lines
            ? lines.map((l, i) => (
                <div
                  key={i}
                  data-sv-diff={l.kind}
                  className={cn(
                    l.kind === 'add' && 'bg-[var(--badge-success-bg)]',
                    l.kind === 'del' && 'bg-[var(--badge-error-bg)]'
                  )}
                >
                  {`${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text}`}
                </div>
              ))
            : (current.data?.content ?? 'Loading…')}
      </pre>
    </>
  )
}
