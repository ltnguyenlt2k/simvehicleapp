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
  ScenarioEditor,
  SimulationTimeline,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim'
import {
  SV_DOCK_TABS,
  type SvDockTabId,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'
import { useWorkflowMap } from '@/hooks/queries/workflows'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { usePanelEditorStore } from '@/stores/panel'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
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

/** Simulation tab (M05-T09/T10): scenario editor next to the timeline of the last simulation. */
function SimulationTab() {
  const workflowId = useSvLintStore((s) => s.workflowId)
  const workflowName = useWorkflowName(workflowId)
  if (!workflowId) return null
  return (
    <div className='flex min-h-0 flex-1'>
      <div className='flex w-[440px] min-w-0 shrink-0 flex-col border-[var(--border)] border-r'>
        <ScenarioEditor key={workflowId} workflowId={workflowId} workflowName={workflowName} />
      </div>
      <SimulationTimeline />
    </div>
  )
}

/** Bottom dock of the vehicle editor; tabs without content show the milestone that brings them. */
export function SvBottomDock({ initialTab = 'problems' }: SvBottomDockProps) {
  const [activeTab, setActiveTab] = useState<SvDockTabId>(initialTab)
  const active = SV_DOCK_TABS.find((tab) => tab.id === activeTab) ?? SV_DOCK_TABS[0]
  const focusProblems = useSvLintStore((s) => s.focusProblems)
  const focusSimulation = useSvSimulationStore((s) => s.focusSimulation)
  const seenFocus = useRef(focusProblems)
  const seenSimulation = useRef(focusSimulation)

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

  return (
    <div
      data-sv='bottom-dock'
      className={cn(
        'flex flex-shrink-0 flex-col border-[var(--border)] border-t bg-[var(--surface-1)]',
        active.id === 'simulation' ? 'h-[280px]' : 'h-[160px]'
      )}
    >
      <div role='tablist' aria-label='Vehicle app output' className='flex gap-1 px-2 pt-1.5'>
        {SV_DOCK_TABS.map((tab) => (
          <Button
            key={tab.id}
            role='tab'
            aria-selected={tab.id === activeTab}
            variant={tab.id === activeTab ? 'active' : 'ghost'}
            size='sm'
            data-sv-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {active.id === 'problems' ? (
        <div role='tabpanel' aria-label='Problems' className='flex min-h-0 flex-1'>
          <ProblemsTab />
        </div>
      ) : active.id === 'simulation' ? (
        <div role='tabpanel' aria-label='Simulation timeline' className='flex min-h-0 flex-1'>
          <SimulationTab />
        </div>
      ) : (
        <div
          role='tabpanel'
          className='flex flex-1 items-center justify-center text-[12px] text-[var(--text-muted)]'
        >
          {`${active.label} — coming in ${active.milestone}`}
        </div>
      )}
    </div>
  )
}
