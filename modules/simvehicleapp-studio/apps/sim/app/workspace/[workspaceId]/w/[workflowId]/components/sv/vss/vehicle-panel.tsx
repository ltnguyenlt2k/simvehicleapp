'use client'

import { useCallback, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { ChipInput } from '@/components/emcn'
import type { SvVssNode } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { SvReleasePicker } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/release-picker'
import {
  dispatchSignalDrop,
  type SvDraggedSignal,
  type SvSignalDragPayload,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/signal-blocks'
import {
  useSvWorkflowId,
  useSvWorkflowRelease,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release'
import { VssNodeRow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-node-view'
import { useSvCatalogSearch, useSvCatalogTree } from '@/hooks/queries/sv-catalog'
import { useDebounce } from '@/hooks/use-debounce'

const SEARCH_DEBOUNCE_MS = 200
const ALWAYS_SELECTABLE = { selectable: true } as const

function toDragged(node: SvVssNode): SvDraggedSignal {
  return {
    path: node.path,
    name: node.name,
    kind: node.kind,
    datatype: node.datatype,
    unit: node.unit,
  }
}

interface SignalRowProps {
  node: SvVssNode
  depth: number
  showPath?: boolean
  expanded?: boolean
  disabled: boolean
  onToggle?: (path: string) => void
}

/** A tree/search row; leaves can be dragged onto the canvas or clicked to open the block menu. */
function SignalRow({ node, depth, showPath, expanded, disabled, onToggle }: SignalRowProps) {
  const isLeaf = node.kind !== 'branch'
  return (
    <div
      role='none'
      draggable={isLeaf && !disabled}
      onDragStart={(e) => {
        const payload: SvSignalDragPayload = { type: 'sv_signal', svSignal: toDragged(node) }
        e.dataTransfer.setData('application/json', JSON.stringify(payload))
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      <VssNodeRow
        node={node}
        depth={depth}
        showPath={showPath}
        expanded={expanded}
        selectability={ALWAYS_SELECTABLE}
        onToggle={onToggle}
        onSelect={(path) => {
          if (disabled) return
          const rect = document
            .querySelector(`[data-sv-panel-path="${CSS.escape(path)}"]`)
            ?.getBoundingClientRect()
          dispatchSignalDrop({
            signal: toDragged(node),
            clientX: rect ? rect.left + 16 : 0,
            clientY: rect ? rect.bottom : 0,
            atViewportCenter: true,
          })
        }}
      />
    </div>
  )
}

interface PanelTreeLevelProps {
  release?: string
  prefix?: string
  depth: number
  expanded: ReadonlySet<string>
  disabled: boolean
  onToggle: (path: string) => void
}

function PanelTreeLevel({
  release,
  prefix,
  depth,
  expanded,
  disabled,
  onToggle,
}: PanelTreeLevelProps) {
  const { data, isLoading, isError } = useSvCatalogTree(release, prefix)
  if (isLoading) return <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>Loading…</p>
  if (isError) {
    return (
      <p className='px-2 py-1 text-[var(--text-error)] text-caption' role='alert'>
        VSS catalog unavailable
      </p>
    )
  }
  return (
    <>
      {data?.nodes.map((node) => (
        <div key={node.path} role='none' data-sv-panel-path={node.path}>
          <SignalRow
            node={node}
            depth={depth}
            expanded={expanded.has(node.path)}
            disabled={disabled}
            onToggle={onToggle}
          />
          {node.kind === 'branch' && expanded.has(node.path) && (
            <div role='group'>
              <PanelTreeLevel
                release={release}
                prefix={node.path}
                depth={depth + 1}
                expanded={expanded}
                disabled={disabled}
                onToggle={onToggle}
              />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

interface PanelSearchProps {
  release?: string
  query: string
  disabled: boolean
}

function PanelSearch({ release, query, disabled }: PanelSearchProps) {
  const { data, isFetching, isError } = useSvCatalogSearch(release, query)
  const leaves = (data?.nodes ?? []).filter((n) => n.kind !== 'branch')
  if (isError) {
    return (
      <p className='px-2 py-1 text-[var(--text-error)] text-caption' role='alert'>
        VSS catalog unavailable
      </p>
    )
  }
  if (!data && isFetching) {
    return <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>Searching…</p>
  }
  if (leaves.length === 0) {
    return <p className='px-2 py-1 text-[var(--text-muted)] text-caption'>No matching signal</p>
  }
  return (
    <>
      {leaves.map((node) => (
        <div key={node.path} role='none' data-sv-panel-path={node.path}>
          <SignalRow node={node} depth={0} showPath disabled={disabled} />
        </div>
      ))}
    </>
  )
}

interface SvVehiclePanelProps {
  /** VSS release of the workflow (M02-T11); catalog default when omitted. */
  release?: string
  disabled?: boolean
}

/**
 * Toolbar "Vehicle" section (ADR-0011 §2, M02-T10): the VSS tree from vss-catalog, loaded one level
 * at a time, plus search. Dragging a signal onto the canvas (or clicking it) opens the
 * Read / When changes / Set menu; the new block gets the signal preset and its name.
 */
export function SvVehiclePanel({ release: releaseProp, disabled = false }: SvVehiclePanelProps) {
  const workflowId = useSvWorkflowId()
  const workflowRelease = useSvWorkflowRelease()
  const release = releaseProp ?? workflowRelease
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  return (
    <section data-sv='vehicle-panel' aria-label='Vehicle signals'>
      <div className='sticky top-0 z-10 flex w-full items-center gap-2 bg-[var(--bg)] px-4 pt-3 pb-2'>
        <button
          type='button'
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className='flex flex-1 items-center gap-2 text-left'
        >
          <span className='text-[var(--text-muted)] text-small'>Vehicle</span>
          <ChevronDown
            className={cn(
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
              !open && '-rotate-90'
            )}
          />
        </button>
      </div>
      {open && (
        <div className='flex flex-col gap-1.5 px-2 pb-2'>
          <SvReleasePicker workflowId={workflowId} disabled={disabled} />
          <ChipInput
            icon={Search}
            className='w-full'
            placeholder='Search vehicle signals'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label='Search vehicle signals'
          />
          <div role='tree' aria-label='Vehicle signal tree' className='flex flex-col'>
            {debouncedQuery.trim() ? (
              <PanelSearch release={release} query={debouncedQuery} disabled={disabled} />
            ) : (
              <PanelTreeLevel
                key={release ?? 'default'}
                release={release}
                depth={0}
                expanded={expanded}
                disabled={disabled}
                onToggle={toggle}
              />
            )}
          </div>
        </div>
      )}
    </section>
  )
}
