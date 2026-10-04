'use client'

import { useCallback, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button, ChipInput } from '@/components/emcn'
import type { SvVssNode } from '@/lib/api/contracts/sv'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import {
  type SvVssLeafKind,
  searchKindFilter,
  vssSelectability,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'
import {
  VssNodeCard,
  VssNodeRow,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-node-view'
import { useSvCatalogNode, useSvCatalogSearch, useSvCatalogTree } from '@/hooks/queries/sv-catalog'
import { useDebounce } from '@/hooks/use-debounce'

const SEARCH_DEBOUNCE_MS = 200

interface VssTreeLevelProps {
  release?: string
  prefix?: string
  depth: number
  kinds: readonly SvVssLeafKind[]
  writes: boolean
  expanded: ReadonlySet<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
}

/** One lazily loaded level of the VSS tree; children load only when their branch is expanded. */
function VssTreeLevel({
  release,
  prefix,
  depth,
  kinds,
  writes,
  expanded,
  onToggle,
  onSelect,
}: VssTreeLevelProps) {
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
        <div key={node.path} role='none'>
          <VssNodeRow
            node={node}
            depth={depth}
            expanded={expanded.has(node.path)}
            selectability={vssSelectability(node, kinds, { writes })}
            onToggle={onToggle}
            onSelect={onSelect}
          />
          {node.kind === 'branch' && expanded.has(node.path) && (
            <div role='group'>
              <VssTreeLevel
                release={release}
                prefix={node.path}
                depth={depth + 1}
                kinds={kinds}
                writes={writes}
                expanded={expanded}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            </div>
          )}
        </div>
      ))}
    </>
  )
}

interface VssSearchResultsProps {
  release?: string
  query: string
  kinds: readonly SvVssLeafKind[]
  writes: boolean
  onSelect: (path: string) => void
}

function VssSearchResults({ release, query, kinds, writes, onSelect }: VssSearchResultsProps) {
  const { data, isFetching, isError } = useSvCatalogSearch(release, query, searchKindFilter(kinds))
  const leaves = useMemo(
    () => (data?.nodes ?? []).filter((n: SvVssNode) => n.kind !== 'branch'),
    [data]
  )

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
        <VssNodeRow
          key={node.path}
          node={node}
          depth={0}
          showPath
          selectability={vssSelectability(node, kinds, { writes })}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

interface VssPathSelectorProps {
  blockId: string
  subBlockId: string
  /** BlockSpec `vssKinds` of the block (ADR-0010 §6). */
  kinds: readonly SvVssLeafKind[]
  /** The block writes the signal (`sv_set_actuator`): array paths are refused (ADR-0018 §2). */
  writes?: boolean
  /** VSS release of the workflow; the catalog default when omitted. */
  release?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
}

/**
 * SubBlock `vss-path-selector` (ADR-0011 §5, M02-T07): binds a block to one VSS signal from the
 * catalog. A bound path is shown read-only with its type/unit/domain and needs an explicit Change;
 * picking browses the lazy tree or searches path/name/description, filtered to the kinds the block allows.
 */
export function VssPathSelector({
  blockId,
  subBlockId,
  kinds,
  writes = false,
  release,
  isPreview = false,
  previewValue,
  disabled = false,
}: VssPathSelectorProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [editing, setEditing] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const debouncedQuery = useDebounce(query, SEARCH_DEBOUNCE_MS)

  const value = (isPreview ? previewValue : storeValue) || undefined
  const readOnly = isPreview || disabled
  const { data: bound } = useSvCatalogNode(release, value)

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const select = useCallback(
    (path: string) => {
      if (readOnly) return
      setStoreValue(path)
      setEditing(false)
      setQuery('')
    },
    [readOnly, setStoreValue]
  )

  if (value && !editing) {
    return (
      <VssNodeCard
        path={value}
        node={bound === undefined ? undefined : bound.node}
        release={bound?.release ?? release}
        onChange={readOnly ? undefined : () => setEditing(true)}
        disabled={readOnly}
      />
    )
  }

  return (
    <div className='flex flex-col gap-1.5' data-sv='vss-path-selector'>
      <div className='flex items-center gap-1.5'>
        <ChipInput
          icon={Search}
          className='min-w-0 flex-1'
          placeholder='Search signals (e.g. speed, state of charge)'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={readOnly}
          aria-label='Search VSS signals'
        />
        {value && (
          <Button size='sm' variant='default' onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      <div
        role='tree'
        aria-label='Vehicle signals'
        className='max-h-[280px] overflow-y-auto rounded-md border border-[var(--border-1)] p-1'
      >
        {debouncedQuery.trim() ? (
          <VssSearchResults
            release={release}
            query={debouncedQuery}
            kinds={kinds}
            writes={writes}
            onSelect={select}
          />
        ) : (
          <VssTreeLevel
            release={release}
            depth={0}
            kinds={kinds}
            writes={writes}
            expanded={expanded}
            onToggle={toggle}
            onSelect={select}
          />
        )}
      </div>
    </div>
  )
}
