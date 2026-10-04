'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Gauge, Search } from 'lucide-react'
import Editor from 'react-simple-code-editor'
import {
  Button,
  ChipInput,
  Code as CodeEditor,
  getCodeEditorProps,
  highlight,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { SVX_GRAMMAR } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/expr/svx-grammar'
import { useSvWorkflowRelease } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/use-workflow-release'
import { VssNodeBadges } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/vss/vss-node-view'
import { useTagSelection } from '@/hooks/kb/use-tag-selection'
import { useSvCatalogNode, useSvCatalogSearch } from '@/hooks/queries/sv-catalog'
import { useDebounce } from '@/hooks/use-debounce'

/** Inserts `text` at `cursor` in `value`; returns the new value and caret position. */
export function insertAt(
  value: string,
  cursor: number,
  text: string
): { value: string; cursor: number } {
  const at = Math.max(0, Math.min(cursor, value.length))
  return { value: value.slice(0, at) + text + value.slice(at), cursor: at + text.length }
}

/** SVX literal for a catalog value: strings quoted, numbers/booleans bare (ADR-0013 §2). */
export function svxLiteral(value: string | number | boolean): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

interface SignalPickerProps {
  release?: string
  onPick: (path: string) => void
}

function SignalPicker({ release, onPick }: SignalPickerProps) {
  const [query, setQuery] = useState('')
  const debounced = useDebounce(query, 200)
  const { data, isFetching } = useSvCatalogSearch(release, debounced)
  const leaves = (data?.nodes ?? []).filter((n) => n.kind !== 'branch').slice(0, 30)
  return (
    <div className='flex w-[320px] flex-col gap-1.5 p-1.5' data-sv='svx-signal-picker'>
      <ChipInput
        icon={Search}
        className='w-full'
        placeholder='Search vehicle signals'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label='Search vehicle signals'
        autoFocus
      />
      <div className='flex max-h-[240px] flex-col overflow-y-auto' role='listbox'>
        {debounced.trim() === '' && (
          <p className='px-1 py-1 text-[var(--text-muted)] text-caption'>Type to search signals</p>
        )}
        {debounced.trim() !== '' && !isFetching && leaves.length === 0 && (
          <p className='px-1 py-1 text-[var(--text-muted)] text-caption'>No matching signal</p>
        )}
        {leaves.map((node) => (
          <button
            key={node.path}
            type='button'
            role='option'
            aria-selected={false}
            data-sv-path={node.path}
            onClick={() => onPick(node.path)}
            className='flex w-full flex-col items-start gap-0.5 rounded-sm px-1.5 py-1 text-left hover-hover:bg-[var(--surface-5)]'
          >
            <span className='truncate font-mono text-[var(--text-primary)] text-caption'>
              {node.path}
            </span>
            <VssNodeBadges node={node} />
          </button>
        ))}
      </div>
    </div>
  )
}

interface SvExpressionInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  /** `$signal`: offer quick picks from the datatype/`allowed` of the block's `path` subBlock. */
  valueType?: string
  pathSubBlockId?: string
  release?: string
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
}

/**
 * SubBlock `sv-expression` (ADR-0013 §4 as amended 2026-10-04, M03-T08): an SVX editor built from
 * the studio's own input stack — react-simple-code-editor with an SVX Prism grammar, Sim's
 * `TagDropdown` on `<` for outputs of earlier blocks, and a catalog picker for `<Vehicle.…>`.
 * Syntax/type diagnostics come from `POST /lint` (M03-T11); nothing is evaluated in the browser.
 */
export function SvExpressionInput({
  blockId,
  subBlockId,
  placeholder = 'e.g. <Vehicle.Speed> > 120 km/h',
  valueType,
  pathSubBlockId = 'path',
  release: releaseProp,
  isPreview = false,
  previewValue,
  disabled = false,
}: SvExpressionInputProps) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  const [pathValue] = useSubBlockValue<string>(blockId, pathSubBlockId)
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const workflowRelease = useSvWorkflowRelease()
  const release = releaseProp ?? workflowRelease
  const [showTags, setShowTags] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [pickerOpen, setPickerOpen] = useState(false)

  const value = (isPreview ? previewValue : storeValue) ?? ''
  const readOnly = isPreview || disabled
  const textarea = () => editorRef.current?.querySelector('textarea') ?? null

  const { data: bound } = useSvCatalogNode(
    release,
    valueType === '$signal' ? pathValue || undefined : undefined
  )
  const quickValues = useMemo(() => {
    const node = bound?.node
    if (!node) return []
    if (node.allowed?.length) return node.allowed.map(svxLiteral)
    if (node.datatype === 'boolean') return ['true', 'false']
    return []
  }, [bound])

  const editorProps = getCodeEditorProps({ isPreview, disabled })

  const highlightSvx = useCallback((code: string) => highlight(code, SVX_GRAMMAR, 'svx'), [])

  const handleChange = useCallback(
    (next: string) => {
      if (readOnly) return
      setStoreValue(next)
      const pos = textarea()?.selectionStart ?? next.length
      setCursor(pos)
      setShowTags(checkTagTrigger(next, pos).show)
    },
    [readOnly, setStoreValue]
  )

  const insert = useCallback(
    (text: string, replaceAll = false) => {
      if (readOnly) return
      const at = textarea()?.selectionStart ?? value.length
      const next = replaceAll ? { value: text, cursor: text.length } : insertAt(value, at, text)
      setStoreValue(next.value)
      setCursor(next.cursor)
      requestAnimationFrame(() => {
        const el = textarea()
        if (el) {
          el.focus()
          el.setSelectionRange(next.cursor, next.cursor)
        }
      })
    },
    [readOnly, setStoreValue, value]
  )

  return (
    <div className='flex flex-col gap-1.5' data-sv='svx-editor'>
      <CodeEditor.Container className='min-h-[44px]'>
        <CodeEditor.Content editorRef={editorRef}>
          <CodeEditor.Placeholder gutterWidth={0} show={value.length === 0}>
            {placeholder}
          </CodeEditor.Placeholder>
          <Editor
            value={value}
            onValueChange={handleChange}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowTags(false)
            }}
            onBlur={() => setShowTags(false)}
            highlight={highlightSvx}
            readOnly={readOnly}
            textareaId={`${blockId}-${subBlockId}-svx`}
            aria-label='Expression'
            {...editorProps}
            className={cn(editorProps.className, '!min-h-[42px]')}
          />
          {showTags && !readOnly && (
            <TagDropdown
              visible={showTags}
              onSelect={(next: string) => {
                emitTagSelection(next)
                setShowTags(false)
              }}
              blockId={blockId}
              activeSourceBlockId={null}
              inputValue={value}
              cursorPosition={cursor}
              onClose={() => setShowTags(false)}
              inputRef={{ current: textarea() as HTMLTextAreaElement }}
            />
          )}
        </CodeEditor.Content>
      </CodeEditor.Container>

      {!readOnly && (
        <div className='flex flex-wrap items-center gap-1'>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen} variant='secondary' size='sm'>
            <PopoverAnchor asChild>
              <Button
                size='sm'
                variant='default'
                onClick={() => setPickerOpen((v) => !v)}
                aria-label='Insert vehicle signal'
              >
                <Gauge className='mr-1 size-[14px]' />
                Signal
              </Button>
            </PopoverAnchor>
            <PopoverContent align='start' side='bottom' sideOffset={4}>
              <SignalPicker
                release={release}
                onPick={(path) => {
                  insert(`<${path}>`)
                  setPickerOpen(false)
                }}
              />
            </PopoverContent>
          </Popover>
          {quickValues.map((v) => (
            <Button
              key={v}
              size='sm'
              variant='outline'
              data-sv-quick-value={v}
              onClick={() => insert(v, true)}
            >
              {v}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
