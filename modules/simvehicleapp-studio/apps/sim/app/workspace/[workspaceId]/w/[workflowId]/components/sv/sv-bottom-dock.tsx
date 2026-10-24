'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import { cn } from '@/lib/core/utils/cn'
import { planConvertFix } from '@/lib/sv/quick-fix'
import {
  type ProblemFix,
  ProblemsList,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/lint/problems-panel'
import {
  MessagesPanel,
  RunConsole,
  SignalsPanel,
  useWorkflowRuns,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run'
import { TestTab } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim'
import {
  SV_DOCK_TABS,
  type SvDockTabId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'
import { BuildLog } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore, usePanelStore } from '@/stores/panel'
import { useSvAssistantStore } from '@/stores/sv/assistant/store'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvRunStore } from '@/stores/sv/run/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvSynCodeStore } from '@/stores/sv/syncode/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { prepareBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Name of the open workflow (scenario default name). */
function useWorkflowName(workflowId: string | null): string {
  const params = useParams<{ workspaceId?: string }>()
  const { data: workflows } = useWorkflowMap(params?.workspaceId)
  return (workflowId ? workflows?.[workflowId]?.name : undefined) ?? 'Scenario'
}

interface SvBottomDockProps {
  initialTab?: SvDockTabId
}

/** Selects the block and brings the field of the problem into view (Problems click, M04-T11). */
function focusField(blockId: string, field?: string) {
  usePanelEditorStore.getState().setCurrentBlockId(blockId)
  const subBlockId = field?.split(/[.[]/)[0]
  if (!subBlockId) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-tab-content="editor"] [data-workflow-search-subblock-id="${CSS.escape(subBlockId)}"]`
      )
      if (!el) return
      el.scrollIntoView({ block: 'center' })
      el.querySelector<HTMLElement>('textarea, input, [role="combobox"]')?.focus({
        preventScroll: true,
      })
    })
  )
}

/** Problems tab bound to the lint store (M03-T11) with Verify results and quick-fixes (M04-T11). */
function ProblemsTab() {
  const diagnostics = useSvLintStore((s) => s.diagnostics)
  const status = useSvLintStore((s) => s.status)
  const verified = useSvLintStore((s) => s.verifiedFresh)
  const blocks = useWorkflowStore((s) => s.blocks)
  const {
    collaborativeBatchAddBlocks,
    collaborativeBatchRemoveEdges,
    collaborativeSetSubblockValue,
  } = useCollaborativeWorkflow()
  const blockName = useCallback((blockId: string) => blocks[blockId]?.name, [blocks])

  const fixFor = useCallback(
    (d: SvDiagnostic): ProblemFix | undefined => {
      const to = (d.data as { to?: unknown } | undefined)?.to
      if (
        d.code !== 'TYPE_NARROWING_REQUIRES_CAST' ||
        !d.blockId ||
        !d.field ||
        typeof to !== 'string'
      ) {
        return undefined
      }
      const { blockId, field } = d
      return {
        label: `Insert Convert to ${to}`,
        run: () => {
          const expression = useSubBlockStore.getState().getValue(blockId, field)
          const plan = planConvertFix({
            blocks: useWorkflowStore.getState().blocks,
            edges: useWorkflowStore.getState().edges,
            blockId,
            field,
            to,
            expression: expression === null || expression === undefined ? '' : String(expression),
            newBlockId: generateId(),
            newEdgeId: generateId,
          })
          if (!plan) return
          const block = prepareBlockState({
            ...plan.block,
            ...(plan.block.parentId
              ? { parentId: plan.block.parentId, extent: 'parent' as const }
              : {}),
          })
          collaborativeBatchRemoveEdges(plan.removeEdgeIds)
          collaborativeBatchAddBlocks(
            [block],
            plan.addEdges,
            {},
            {},
            { [plan.block.id]: plan.values }
          )
          collaborativeSetSubblockValue(plan.field.blockId, plan.field.subBlockId, plan.field.value)
          usePanelEditorStore.getState().setCurrentBlockId(plan.block.id)
        },
      }
    },
    [collaborativeBatchAddBlocks, collaborativeBatchRemoveEdges, collaborativeSetSubblockValue]
  )

  return (
    <ProblemsList
      diagnostics={diagnostics}
      status={status}
      verified={verified}
      blockName={blockName}
      onSelect={focusField}
      fixFor={fixFor}
    />
  )
}

/**
 * Test tab (M18-T04, ADR-0058): the workflow's test cases, the editor of the active one and the timeline of the last
 * simulation; its empty state asks the assistant or opens Signals to record a live run.
 */
function SimulationTab({ onRecord }: { onRecord: () => void }) {
  const workflowId = useSvLintStore((s) => s.workflowId)
  const workflowName = useWorkflowName(workflowId)
  if (!workflowId) return null
  return (
    <TestTab
      key={workflowId}
      workflowId={workflowId}
      workflowName={workflowName}
      onRecord={onRecord}
      onAskAssistant={(text) => {
        useSvAssistantStore.getState().setPrefill(text)
        usePanelStore.getState().setActiveTab('copilot')
      }}
    />
  )
}

/** Build log tab (M07-T18): diagnostics of the open workflow focus their block. */
function BuildLogTab() {
  const workflowId = useSvLintStore((s) => s.workflowId)
  const params = useParams<{ workspaceId?: string }>()
  const { data: workflows } = useWorkflowMap(params?.workspaceId)
  const blocks = useWorkflowStore((s) => s.blocks)
  const workflowName = useCallback((id: string) => workflows?.[id]?.name, [workflows])
  const blockName = useCallback((blockId: string) => blocks[blockId]?.name, [blocks])
  return (
    <BuildLog
      workflowId={workflowId}
      workflowName={workflowName}
      blockName={blockName}
      onSelectBlock={focusField}
    />
  )
}

/** Run console tab (M08-T08): log + trace of the live run; trace lines name their block. */
function RunConsoleTab() {
  const { run } = useWorkflowRuns()
  const blocks = useWorkflowStore((s) => s.blocks)
  const blockName = useCallback((blockId: string) => blocks[blockId]?.name, [blocks])
  return <RunConsole run={run} blockName={blockName} />
}

/**
 * Live tab (M18-T05, ADR-0058 §6): the app's signals — watch and inject — next to its run console or its MQTT
 * messages.
 */
function LiveTab({ pane, onPane }: { pane: LivePane; onPane: (p: LivePane) => void }) {
  return (
    <div className='flex min-h-0 flex-1' data-sv='live'>
      <div className='flex min-w-0 flex-[3] flex-col border-[var(--border)] border-r'>
        <SignalsPanel />
      </div>
      <div className='flex min-w-0 flex-[2] flex-col'>
        <div role='tablist' aria-label='Live output' className='flex gap-1 px-2 pt-1'>
          {LIVE_PANES.map((p) => (
            <Button
              key={p.id}
              role='tab'
              aria-selected={p.id === pane}
              size='sm'
              variant={p.id === pane ? 'active' : 'ghost'}
              data-sv-live-pane={p.id}
              onClick={() => onPane(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {pane === 'run-console' ? <RunConsoleTab /> : <MessagesPanel />}
      </div>
    </div>
  )
}

const LIVE_PANES = [
  { id: 'run-console', label: 'Run console' },
  { id: 'messages', label: 'Messages' },
] as const
type LivePane = (typeof LIVE_PANES)[number]['id']

/** Bottom dock of the vehicle editor: Problems, Test, Live, and Build log while SynCode runs or failed. */
export function SvBottomDock({ initialTab = 'problems' }: SvBottomDockProps) {
  const [activeTab, setActiveTab] = useState<SvDockTabId>(initialTab)
  const [livePane, setLivePane] = useState<LivePane>('run-console')
  const [buildLogOpen, setBuildLogOpen] = useState(initialTab === 'build-log')
  const tabs = SV_DOCK_TABS.filter((tab) => tab.id !== 'build-log' || buildLogOpen)
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]
  const focusProblems = useSvLintStore((s) => s.focusProblems)
  const focusSimulation = useSvSimulationStore((s) => s.focusSimulation)
  const focusBuildLog = useSvSynCodeStore((s) => s.focusBuildLog)
  const focusRunConsole = useSvRunStore((s) => s.focusRunConsole)
  const seenFocus = useRef(focusProblems)
  const seenSimulation = useRef(focusSimulation)
  const seenBuildLog = useRef(focusBuildLog)
  const seenRunConsole = useRef(focusRunConsole)

  // Verify brings the Problems tab to the front, Simulate the timeline.
  useEffect(() => {
    if (focusProblems === seenFocus.current) return
    seenFocus.current = focusProblems
    setActiveTab('problems')
  }, [focusProblems])
  useEffect(() => {
    if (focusSimulation === seenSimulation.current) return
    seenSimulation.current = focusSimulation
    setActiveTab('simulation')
  }, [focusSimulation])
  useEffect(() => {
    if (focusBuildLog === seenBuildLog.current) return
    seenBuildLog.current = focusBuildLog
    setBuildLogOpen(true)
    setActiveTab('build-log')
  }, [focusBuildLog])
  useEffect(() => {
    if (focusRunConsole === seenRunConsole.current) return
    seenRunConsole.current = focusRunConsole
    setLivePane('run-console')
    setActiveTab('live')
  }, [focusRunConsole])

  return (
    <div
      data-sv='bottom-dock'
      className={cn(
        'flex flex-shrink-0 flex-col border-[var(--border)] border-t bg-[var(--surface-1)]',
        active.id === 'problems' ? 'h-[160px]' : 'h-[280px]'
      )}
    >
      <div role='tablist' aria-label='Vehicle app output' className='flex gap-1 px-2 pt-1.5'>
        {tabs.map((tab) => (
          <Button
            key={tab.id}
            role='tab'
            aria-selected={tab.id === active.id}
            variant={tab.id === active.id ? 'active' : 'ghost'}
            size='sm'
            data-sv-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
        {buildLogOpen && (
          <Button
            variant='ghost'
            size='sm'
            aria-label='Close Build log'
            data-sv='close-build-log'
            onClick={() => {
              setBuildLogOpen(false)
              if (active.id === 'build-log') setActiveTab('problems')
            }}
          >
            ×
          </Button>
        )}
      </div>
      {active.id === 'problems' ? (
        <div role='tabpanel' aria-label='Problems' className='flex min-h-0 flex-1'>
          <ProblemsTab />
        </div>
      ) : active.id === 'simulation' ? (
        <div role='tabpanel' aria-label='Test' className='flex min-h-0 flex-1'>
          <SimulationTab onRecord={() => setActiveTab('live')} />
        </div>
      ) : active.id === 'live' ? (
        <div role='tabpanel' aria-label='Live' className='flex min-h-0 flex-1'>
          <LiveTab pane={livePane} onPane={setLivePane} />
        </div>
      ) : (
        <div role='tabpanel' aria-label='Build log' className='flex min-h-0 flex-1'>
          <BuildLogTab />
        </div>
      )}
    </div>
  )
}
