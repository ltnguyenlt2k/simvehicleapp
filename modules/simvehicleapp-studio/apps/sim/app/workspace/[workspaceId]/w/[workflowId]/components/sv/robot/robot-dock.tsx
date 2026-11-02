'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, ChipInput } from '@/components/emcn'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'
import type { SvRobotDiagnostic, SvRobotRunEvent } from '@/lib/api/contracts/sv-robotics'
import { cn } from '@/lib/core/utils/cn'
import type { SvLocale, SvMessageKey, SvTranslate } from '@/lib/sv/i18n'
import { useSvLocale, useSvT } from '@/lib/sv/i18n/locale-provider'
import { svPhraseVi } from '@/lib/sv/i18n/phrase'
import { ProblemsList } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/lint/problems-panel'
import { useRobotFlow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
import { useSvRobotLint, useSvRobotRun } from '@/hooks/queries/sv-robotics'
import { useDebounce } from '@/hooks/use-debounce'
import { usePanelEditorStore } from '@/stores/panel'
import { useSvRobotStore } from '@/stores/sv/robot/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const TABS = [
  { id: 'problems', label: 'dock.problems' },
  { id: 'live', label: 'dock.live' },
] as const satisfies readonly { id: 'problems' | 'live'; label: SvMessageKey }[]

const STATE_VARIANT = {
  running: 'green',
  finished: 'gray',
  failed: 'red',
  stopped: 'amber',
} as const
const PHASE_TONE: Record<string, string> = {
  SUCCEEDED: 'text-[var(--text-success)]',
  FAILED: 'text-[var(--text-error)]',
  REJECTED: 'text-[var(--text-error)]',
  TIMED_OUT: 'text-[var(--text-error)]',
  CANCELLED: 'text-[var(--warning)]',
}
const ROW_LIMIT = 300

/**
 * Problem text in the page's language: in English the compiler's own message (it names the signal or the value); in
 * another language the code's sentence, so no English is mixed in.
 */
function problemMessage(t: SvTranslate, locale: SvLocale, code: string, message: string): string {
  if (locale === 'en') return message
  const key = `diag.${code}` as SvMessageKey
  const text = t(key)
  return text === key ? message : text
}

/** One line of the robot run log, as a sentence (`→ Bow`, `Bow → Motion.Perform SUCCEEDED #d558664a`). */
function eventLine(
  t: SvTranslate,
  e: SvRobotRunEvent,
  name: (id?: string) => string,
  locale: SvLocale
): { text: string; tone?: string } | null {
  // Runtime messages ("robot reported SUCCEEDED") are English; shown in the page's language when known.
  const message = e.message && locale === 'vi' ? (svPhraseVi(e.message) ?? e.message) : e.message
  switch (e.ev) {
    case 'node':
      return e.state === 'started' ? { text: `  → ${name(e.node)}` } : null
    case 'command':
      if (!e.phase || e.phase === 'ACCEPTED' || e.phase === 'RUNNING') return null
      return {
        text: `  ${name(e.node)} → ${(e.path ?? '').replace('Robot.', '')} ${e.phase}${message ? ` (${message})` : ''}${e.requestId ? ` #${e.requestId.slice(0, 8)}` : ''}`,
        tone: PHASE_TONE[e.phase],
      }
    case 'log':
      return {
        text: `${e.level ?? 'info'}: ${e.message ?? ''}`,
        tone:
          e.level === 'error'
            ? 'text-[var(--text-error)]'
            : e.level === 'warning'
              ? 'text-[var(--warning)]'
              : undefined,
      }
    case 'warning':
    case 'error':
      return { text: `✖ ${message ?? e.ev}`, tone: 'text-[var(--text-error)]' }
    case 'stop':
      return {
        text: t(
          String(e.confirmed) === 'true' ? 'robot.live.stopConfirmed' : 'robot.live.stopUnconfirmed'
        ),
        tone: 'text-[var(--warning)]',
      }
    default:
      return null
  }
}

/** Selects the block of a problem (as the vehicle Problems tab). */
function focusBlock(blockId: string) {
  usePanelEditorStore.getState().setCurrentBlockId(blockId)
}

/** Problems tab of a robot workflow: adapter issues and RobotFlow compiler diagnostics (checked as you edit). */
function RobotProblemsTab() {
  const { t, locale } = useSvLocale()
  const flow = useRobotFlow()
  const mode = useSvRobotStore((s) => s.mode)
  const debounced = useDebounce(flow?.json, 400)
  const lint = useSvRobotLint(flow?.workflowId, mode, debounced)
  const blocks = useWorkflowStore((s) => s.blocks)
  const blockName = useCallback((blockId: string) => blocks[blockId]?.name, [blocks])

  const diagnostics = useMemo<SvDiagnostic[]>(() => {
    const fromCompiler = (lint.data?.diagnostics ?? []).map((d: SvRobotDiagnostic) => ({
      code: d.code,
      severity: d.severity,
      stage: 'robotflow',
      blockId: d.nodeId,
      field: d.prop,
      message: problemMessage(t, locale, d.code, d.message),
      docs: '',
    }))
    const fromAdapter = (flow?.issues ?? []).map((i) => ({
      code: i.code,
      severity: 'error' as const,
      stage: 'adapter',
      blockId: i.blockId,
      message: problemMessage(t, locale, i.code, i.message),
      docs: '',
    }))
    return [...fromAdapter, ...fromCompiler]
  }, [flow?.issues, lint.data, locale, t])

  const status = lint.isFetching ? 'checking' : lint.isError ? 'unavailable' : 'ok'
  return (
    <ProblemsList
      diagnostics={diagnostics}
      status={status}
      blockName={blockName}
      onSelect={focusBlock}
    />
  )
}

/**
 * Live tab of a robot workflow: state of the run, the block being executed (also outlined on the canvas), robot
 * command results with their request ids, and the workflow's log — what the vehicle Run console shows for an app.
 */
function RobotLiveTab() {
  const { t, locale } = useSvLocale()
  const runId = useSvRobotStore((s) => s.runId)
  const buildId = useSvRobotStore((s) => s.buildId)
  const deploymentId = useSvRobotStore((s) => s.deploymentId)
  const mode = useSvRobotStore((s) => s.mode)
  const setActiveNode = useSvRobotStore((s) => s.setActiveNode)
  const blocks = useWorkflowStore((s) => s.blocks)
  const run = useSvRobotRun(runId ?? undefined)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLOListElement>(null)
  const events = run.data?.events ?? []

  const name = useCallback((id?: string) => (id ? (blocks[id]?.name ?? id) : ''), [blocks])
  const active = useMemo(() => {
    if (run.data?.state !== 'running') return null
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.ev === 'node') return e.state === 'started' ? (e.node ?? null) : null
    }
    return null
  }, [events, run.data?.state])

  useEffect(() => {
    setActiveNode(active)
  }, [active, setActiveNode])

  const lines = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events
      .flatMap((e) => {
        const line = eventLine(t, e, name, locale)
        return line && (!q || line.text.toLowerCase().includes(q)) ? [{ seq: e.seq, ...line }] : []
      })
      .slice(-ROW_LIMIT)
  }, [events, locale, name, query, t])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div className='flex min-h-0 flex-1 flex-col' data-sv='robot-live'>
      <div className='flex shrink-0 flex-wrap items-center gap-2 border-[var(--border)] border-b px-2 py-1'>
        {run.data ? (
          <Badge
            size='sm'
            variant={STATE_VARIANT[run.data.state]}
            data-rf-run-state
            data-sv-state={run.data.state}
          >
            {t(`robot.run.${run.data.state}` as SvMessageKey)}
          </Badge>
        ) : (
          <span className='text-[12px] text-[var(--text-muted)]' data-rf-run-state>
            {t('robot.live.empty')}
          </span>
        )}
        {active && (
          <Badge size='sm' variant='blue' data-rf-active>
            ▶ {name(active)}
          </Badge>
        )}
        <ChipInput
          aria-label={t('robot.live.search')}
          placeholder={t('common.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='w-[200px]'
        />
        <span className='ml-auto truncate text-[11px] text-[var(--text-muted)]' data-rf-identity>
          {t('robot.live.identity', {
            build: buildId ? buildId.slice(0, 12) : '—',
            deploy: deploymentId ? deploymentId.slice(0, 8) : '—',
            mode: t(mode === 'mock' ? 'robot.mode.mock' : 'robot.mode.rosSim'),
          })}
        </span>
      </div>
      <ol
        ref={scrollRef}
        role='log'
        aria-label={t('robot.live.log')}
        data-rf-timeline
        className='min-h-0 flex-1 overflow-auto py-1 font-mono text-[11px]'
      >
        {lines.map((l) => (
          <li
            key={l.seq}
            className={cn(
              'truncate whitespace-pre px-2 leading-[18px]',
              l.tone ?? 'text-[var(--text-primary)]'
            )}
            title={l.text}
          >
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Bottom dock of a robot workflow, the vehicle dock's layout: Problems and Live. */
export function RobotDock() {
  const t = useSvT()
  const [activeTab, setActiveTab] = useState<'problems' | 'live'>('problems')
  const focus = useSvRobotStore((s) => s.focus)
  const seen = useRef(focus.n)

  useEffect(() => {
    if (focus.n === seen.current) return
    seen.current = focus.n
    setActiveTab(focus.tab)
  }, [focus])

  return (
    <div
      data-sv='bottom-dock'
      data-rf-dock
      className={cn(
        'flex flex-shrink-0 flex-col border-[var(--border)] border-t bg-[var(--surface-1)]',
        activeTab === 'problems' ? 'h-[160px]' : 'h-[280px]'
      )}
    >
      <div role='tablist' aria-label={t('dock.label')} className='flex gap-1 px-2 pt-1.5'>
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            role='tab'
            aria-selected={tab.id === activeTab}
            variant={tab.id === activeTab ? 'active' : 'ghost'}
            size='sm'
            data-sv-tab={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {t(tab.label)}
          </Button>
        ))}
      </div>
      {activeTab === 'problems' ? (
        <div role='tabpanel' aria-label={t('dock.problems')} className='flex min-h-0 flex-1'>
          <RobotProblemsTab />
        </div>
      ) : (
        <div role='tabpanel' aria-label={t('dock.live')} className='flex min-h-0 flex-1'>
          <RobotLiveTab />
        </div>
      )}
    </div>
  )
}
