'use client'

import { useCallback, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { ChipTag } from '@/components/emcn'
import type { SvRssNode } from '@/lib/api/contracts/sv-robotics'
import { cn } from '@/lib/core/utils/cn'
import type { SvMessageKey } from '@/lib/sv/i18n'
import { useSvT } from '@/lib/sv/i18n/locale-provider'
import {
  dispatchSignalDrop,
  type SvDraggedSignal,
  type SvSignalDragPayload,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/signal-blocks'
import { useSvRobotCatalog } from '@/hooks/queries/sv-robotics'

/** Same indentation steps as the VSS tree. */
const ROW_INDENT = ['pl-1', 'pl-4', 'pl-7', 'pl-10', 'pl-[52px]', 'pl-[64px]', 'pl-[76px]'] as const

/** Readable leaves: what a condition can test. Commands and setpoints are robot blocks, not signals to drop. */
const READABLE = new Set<SvRssNode['kind']>(['sensor', 'attribute'])

function toDragged(node: SvRssNode): SvDraggedSignal {
  return {
    path: node.path,
    name: node.name,
    kind: node.kind as SvDraggedSignal['kind'],
    datatype: node.type as SvDraggedSignal['datatype'],
    unit: node.unit,
    values: node.values,
    catalog: 'rss',
  }
}

interface RssRowProps {
  node: SvRssNode
  depth: number
  expanded: boolean
  showPath?: boolean
  disabled: boolean
  onToggle: (path: string) => void
}

/** A row of the RSS tree: branches toggle; signals drag onto the canvas or open the block menu on click. */
function RssRow({ node, depth, expanded, showPath = false, disabled, onToggle }: RssRowProps) {
  const t = useSvT()
  const isBranch = node.kind === 'branch'
  const type = [node.type, node.unit].filter(Boolean).join(' · ')
  return (
    <div
      role='none'
      data-sv-panel-path={node.path}
      draggable={!isBranch && !disabled}
      onDragStart={(e) => {
        const payload: SvSignalDragPayload = { type: 'sv_signal', svSignal: toDragged(node) }
        e.dataTransfer.setData('application/json', JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <button
        type='button'
        role='treeitem'
        aria-expanded={isBranch ? expanded : undefined}
        disabled={!isBranch && disabled}
        title={node.description}
        data-sv-path={node.path}
        onClick={(e) => {
          if (isBranch) return onToggle(node.path)
          const rect = e.currentTarget.getBoundingClientRect()
          dispatchSignalDrop({
            signal: toDragged(node),
            clientX: rect.left + 16,
            clientY: rect.bottom,
            atViewportCenter: true,
          })
        }}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-sm py-1 pr-1 text-left text-small hover-hover:bg-[var(--surface-5)]',
          ROW_INDENT[Math.min(depth, ROW_INDENT.length - 1)]
        )}
      >
        <ChevronRight
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
            expanded && 'rotate-90',
            !isBranch && 'invisible'
          )}
        />
        <span data-sv-no-translate className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
          {showPath ? node.path : node.name}
        </span>
        {!isBranch && (
          <span className='inline-flex flex-wrap items-center gap-1'>
            <ChipTag variant='gray' data-sv-kind={node.kind}>
              {t(`rss.kind.${node.kind}` as SvMessageKey)}
            </ChipTag>
            {type && <ChipTag variant='mono'>{type}</ChipTag>}
          </span>
        )}
      </button>
    </div>
  )
}

interface SvRssTreeProps {
  query: string
  disabled?: boolean
}

/**
 * Signal tree of a robot workflow (ADR-0068 Notes 2026-11-01): the RSS catalog of the robot profile, the counterpart
 * of the VSS tree. Dropping a signal offers When condition / If / Wait until with the condition preset.
 */
export function SvRssTree({ query, disabled = false }: SvRssTreeProps) {
  const t = useSvT()
  const { data, isLoading, isError } = useSvRobotCatalog(true)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(['Robot']))

  const nodes = useMemo(
    () => (data?.nodes ?? []).filter((n) => n.kind === 'branch' || READABLE.has(n.kind)),
    [data]
  )
  const children = useMemo(() => {
    const map = new Map<string, SvRssNode[]>()
    for (const node of nodes) {
      const parent = node.path.includes('.') ? node.path.slice(0, node.path.lastIndexOf('.')) : ''
      map.set(parent, [...(map.get(parent) ?? []), node])
    }
    // Branches without a readable leaf below them are dropped (a branch of commands only).
    const hasLeaf = (path: string): boolean =>
      (map.get(path) ?? []).some((n) => n.kind !== 'branch' || hasLeaf(n.path))
    for (const [parent, list] of map) {
      map.set(
        parent,
        list.filter((n) => n.kind !== 'branch' || hasLeaf(n.path))
      )
    }
    return map
  }, [nodes])

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  if (isLoading)
    return <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>{t('common.loading')}</p>
  if (isError) {
    return (
      <p className='px-2 py-1 text-[var(--text-error)] text-caption' role='alert'>
        {t('rss.unavailable')}
      </p>
    )
  }

  const q = query.trim().toLowerCase()
  if (q) {
    const hits = nodes.filter(
      (n) =>
        n.kind !== 'branch' &&
        (n.path.toLowerCase().includes(q) || n.description.toLowerCase().includes(q))
    )
    if (!hits.length) {
      return <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>{t('rss.noMatch')}</p>
    }
    return (
      <>
        {hits.map((node) => (
          <RssRow
            key={node.path}
            node={node}
            depth={0}
            expanded={false}
            showPath
            disabled={disabled}
            onToggle={toggle}
          />
        ))}
      </>
    )
  }

  const level = (parent: string, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((node) => (
      <div key={node.path} role='none'>
        <RssRow
          node={node}
          depth={depth}
          expanded={expanded.has(node.path)}
          disabled={disabled}
          onToggle={toggle}
        />
        {node.kind === 'branch' && expanded.has(node.path) && (
          <div role='group'>{level(node.path, depth + 1)}</div>
        )}
      </div>
    ))
  return <>{level('', 0)}</>
}
