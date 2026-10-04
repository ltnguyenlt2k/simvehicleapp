import { ChevronRight } from 'lucide-react'
import { Button, ChipTag } from '@/components/emcn'
import type { SvVssNode } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import {
  formatVssDomain,
  formatVssType,
  isVssArray,
  SV_VSS_KIND_LABEL,
  type VssSelectability,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-format'

interface VssNodeBadgesProps {
  node: SvVssNode
}

/** Kind, datatype/unit (arrays get a `[ ]` tag, ADR-0018) and deprecation of a node. */
export function VssNodeBadges({ node }: VssNodeBadgesProps) {
  const type = formatVssType(node)
  return (
    <span className='inline-flex flex-wrap items-center gap-1'>
      <ChipTag variant='gray' data-sv-kind={node.kind}>
        {SV_VSS_KIND_LABEL[node.kind]}
      </ChipTag>
      {isVssArray(node) && (
        <ChipTag variant='gray' title='Array value: read-only'>
          [ ]
        </ChipTag>
      )}
      {type && <ChipTag variant='mono'>{type}</ChipTag>}
      {node.deprecation && (
        <ChipTag variant='invite' invalid title={node.deprecation}>
          Deprecated
        </ChipTag>
      )}
    </span>
  )
}

interface VssNodeCardProps {
  path: string
  /** `null` = the path does not exist in the selected release; `undefined` = still loading. */
  node: SvVssNode | null | undefined
  release?: string
  onChange?: () => void
  disabled?: boolean
}

/**
 * Read-only view of the bound signal ("locked" path, ADR-0011 Notes): changing it takes an explicit
 * click on Change so a drag-created block keeps its signal.
 */
export function VssNodeCard({ path, node, release, onChange, disabled = false }: VssNodeCardProps) {
  const domain = node ? formatVssDomain(node) : ''
  return (
    <div
      className='flex flex-col gap-1.5 rounded-md border border-[var(--border-1)] p-2'
      data-sv='vss-path-card'
      data-sv-path={path}
    >
      <div className='flex items-start justify-between gap-2'>
        <code className='break-all font-mono text-[var(--text-primary)] text-small'>{path}</code>
        {onChange && (
          <Button size='sm' variant='default' onClick={onChange} disabled={disabled}>
            Change
          </Button>
        )}
      </div>
      {node === null && (
        <p className='text-[var(--text-error)] text-small' role='alert'>
          Not found in VSS {release ?? 'release'} — pick another signal.
        </p>
      )}
      {node && <VssNodeBadges node={node} />}
      {domain && <p className='text-[var(--text-secondary)] text-small'>Values: {domain}</p>}
      {node?.description && (
        <p className='text-[var(--text-tertiary)] text-small'>{node.description}</p>
      )}
    </div>
  )
}

/** Static indentation classes (Tailwind cannot see computed class names); VSS 4.x is at most 9 levels deep. */
const ROW_INDENT = [
  'pl-1',
  'pl-4',
  'pl-7',
  'pl-10',
  'pl-[52px]',
  'pl-[64px]',
  'pl-[76px]',
  'pl-[88px]',
  'pl-[100px]',
  'pl-[112px]',
] as const

interface VssNodeRowProps {
  node: SvVssNode
  depth: number
  expanded?: boolean
  selectability: VssSelectability
  /** Show the full path (search results) instead of the name (tree). */
  showPath?: boolean
  onToggle?: (path: string) => void
  onSelect?: (path: string) => void
}

/**
 * One row of the tree or of the search results. Branches toggle; leaves the block cannot use stay
 * visible but disabled with the reason as tooltip, so the user sees why (e.g. a sensor in Set).
 */
export function VssNodeRow({
  node,
  depth,
  expanded = false,
  selectability,
  showPath = false,
  onToggle,
  onSelect,
}: VssNodeRowProps) {
  const isBranch = node.kind === 'branch'
  const disabled = !isBranch && !selectability.selectable
  return (
    <button
      type='button'
      role='treeitem'
      aria-expanded={isBranch ? expanded : undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={selectability.reason ?? node.description}
      data-sv-path={node.path}
      onClick={() => (isBranch ? onToggle?.(node.path) : onSelect?.(node.path))}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm py-1 pr-1 text-left text-small hover-hover:bg-[var(--surface-5)]',
        ROW_INDENT[Math.min(depth, ROW_INDENT.length - 1)],
        disabled && 'cursor-not-allowed opacity-50 hover-hover:bg-transparent'
      )}
    >
      <ChevronRight
        className={cn(
          'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
          expanded && 'rotate-90',
          !isBranch && 'invisible'
        )}
      />
      <span className='min-w-0 flex-1 truncate text-[var(--text-primary)]'>
        {showPath ? node.path : node.name}
      </span>
      {!isBranch && <VssNodeBadges node={node} />}
    </button>
  )
}
