'use client'

import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/emcn'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'
import type { ConnectedBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/hooks/use-block-connections'
import {
  insertIntoLastField,
  useSvSampleValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/editor/earlier-data'
import { normalizeName } from '@/executor/constants'

const logger = createLogger('FieldItem')

/**
 * Represents a schema field with optional nested children
 */
export interface SchemaField {
  name: string
  type: string
  description?: string
  children?: SchemaField[]
}

interface FieldItemProps {
  connection: ConnectedBlock
  field: SchemaField
  path: string
  level: number
  hasChildren?: boolean
  isExpanded?: boolean
  onToggleExpand?: (path: string) => void
}

/**
 * Individual field item component with drag functionality
 */
export function FieldItem({
  connection,
  field,
  path,
  level,
  hasChildren,
  isExpanded,
  onToggleExpand,
}: FieldItemProps) {
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const normalizedBlockName = normalizeName(connection.name)
      const fullTag = `${normalizedBlockName}.${path}`

      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          type: 'connectionBlock',
          connectionData: {
            sourceBlockId: connection.id,
            tag: fullTag,
            blockName: connection.name,
            fieldName: field.name,
            fieldType: field.type,
          },
        })
      )
      e.dataTransfer.effectAllowed = 'copy'

      logger.info('Field drag started', { tag: fullTag, field: field.name })
    },
    [connection, field, path]
  )

  // SV: a sample value from the last Simulate/Run; a click inserts the reference (ADR-0059 §5).
  const sample = useSvSampleValue(connection.id, path)
  const handleClick = useCallback(() => {
    if (hasChildren) {
      onToggleExpand?.(path)
      return
    }
    insertIntoLastField(`${normalizeName(connection.name)}.${path}`)
  }, [hasChildren, onToggleExpand, path, connection.name])

  return (
    <div
      role='treeitem'
      aria-expanded={hasChildren ? isExpanded : undefined}
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={(event) => handleKeyboardActivation(event, handleClick)}
      data-sv-output={`${connection.id}.${path}`}
      className={clsx(
        'group flex h-[26px] cursor-grab items-center gap-2 rounded-lg px-1.5 text-sm hover-hover:bg-[var(--surface-6)] active:cursor-grabbing dark:hover-hover:bg-[var(--surface-5)]',
        hasChildren && 'cursor-pointer'
      )}
    >
      <span
        className={clsx(
          'min-w-0 flex-1 truncate font-medium',
          'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]'
        )}
      >
        {field.name}
      </span>
      {sample !== null && (
        <span
          data-sv-sample
          className='max-w-[96px] shrink-0 truncate font-mono text-[var(--text-muted)] text-xs'
        >
          {sample}
        </span>
      )}
      <Badge className='flex-shrink-0 rounded-sm px-1.5 py-[1px] font-mono text-xs'>
        {field.type}
      </Badge>
      {hasChildren && (
        <ChevronDown
          className={clsx(
            'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-100',
            'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
            isExpanded && 'rotate-180'
          )}
        />
      )}
    </div>
  )
}
