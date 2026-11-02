'use client'

import { useCallback, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  Bot,
  Check,
  ChevronDown,
  ExternalLink,
  Hammer,
  Play,
  Rocket,
  Rows3,
  ShieldCheck,
  Square,
} from 'lucide-react'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@/components/emcn'
import type { SvRobotMode } from '@/lib/api/contracts/sv-robotics'
import { svPlural } from '@/lib/sv/i18n'
import { useSvLocale } from '@/lib/sv/i18n/locale-provider'
import { useRobotFlow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import {
  useSvRobotBuild,
  useSvRobotConfig,
  useSvRobotDeploy,
  useSvRobotLint,
  useSvRobotRun,
  useSvRobotStart,
  useSvRobotStop,
} from '@/hooks/queries/sv-robotics'
import { useDebounce } from '@/hooks/use-debounce'
import { useSvCanvasViewStore } from '@/stores/sv/canvas-view/store'
import { useSvRobotStore } from '@/stores/sv/robot/store'

const MODES: SvRobotMode[] = ['ros-sim', 'mock']

/** A thin divider between the groups of the bar (same as the vehicle bar). */
function Separator() {
  return <div aria-hidden className='mx-1 h-4 w-px shrink-0 bg-[var(--border)]' />
}

/**
 * Actions of a robot workflow, in the vehicle bar's layout (ADR-0054, ADR-0068 §5): check │ build → deploy → start /
 * stop │ Robot Zoo, then the robot the actions target and a status pill; the next step is the primary button and the
 * reason an action cannot run is said in words on the right. Deploy never starts; Start asks for confirmation naming
 * the robot; Stop is always available while the app runs.
 */
export function RobotActionBar() {
  const { t, locale } = useSvLocale()
  const flow = useRobotFlow()
  const mode = useSvRobotStore((s) => s.mode)
  const buildId = useSvRobotStore((s) => s.buildId)
  const deploymentId = useSvRobotStore((s) => s.deploymentId)
  const runId = useSvRobotStore((s) => s.runId)
  const details = useSvCanvasViewStore((s) => s.details)
  const [confirming, setConfirming] = useState(false)

  const debounced = useDebounce(flow?.json, 400)
  const lint = useSvRobotLint(flow?.workflowId, mode, debounced)
  const config = useSvRobotConfig(true)
  const run = useSvRobotRun(runId ?? undefined)
  const build = useSvRobotBuild()
  const deploy = useSvRobotDeploy()
  const start = useSvRobotStart()
  const stop = useSvRobotStop()

  const diagnostics = lint.data?.diagnostics ?? []
  const errors =
    diagnostics.filter((d) => d.severity === 'error').length + (flow?.issues.length ?? 0)
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const running = run.data?.state === 'running'
  const target = config.data?.targets.find((x) => x.mode === mode)
  const robot = target && !('error' in target) ? target : null
  const robotName = robot?.robotId ?? t('robot.target.robot')
  const modeName = t(mode === 'mock' ? 'robot.mode.mock' : 'robot.mode.rosSim')

  const targetLabel = useMemo(() => {
    if (!target) return `${modeName} · ${t('robot.target.checking')}`
    if (!robot) return `${modeName} · ${t('robot.target.unavailable')}`
    return [modeName, robot.robotId, robot.robotMode, robot.scene].filter(Boolean).join(' · ')
  }, [modeName, robot, target, t])

  const checkText = lint.isFetching
    ? t('robot.check.checking')
    : errors
      ? svPlural(t, errors, 'common.errors.one', 'common.errors.other')
      : warnings
        ? `OK · ${svPlural(t, warnings, 'common.warnings.one', 'common.warnings.other')}`
        : 'OK'

  const pill = useMemo(() => {
    if (running) return { tone: 'busy', label: t('robot.pill.running') } as const
    if (run.data?.state === 'finished')
      return { tone: 'ok', label: t('robot.pill.finished') } as const
    if (run.data?.state === 'failed')
      return { tone: 'error', label: t('robot.pill.failed') } as const
    if (run.data?.state === 'stopped')
      return { tone: 'error', label: t('robot.pill.stopped') } as const
    if (deploymentId) return { tone: 'ok', label: t('robot.pill.deployed') } as const
    if (buildId) return { tone: 'ok', label: t('robot.pill.built') } as const
    return null
  }, [buildId, deploymentId, run.data?.state, running, t])

  /** The next step, or why an action cannot run, in words (as the vehicle bar's hint). */
  const hint = !flow
    ? null
    : errors
      ? t('robot.hint.fix')
      : !robot
        ? t('robot.hint.noRobot')
        : !buildId
          ? t('robot.hint.build')
          : !deploymentId
            ? t('robot.hint.deploy')
            : running
              ? t('robot.hint.running')
              : t('robot.hint.start', { robot: robotName })

  const onCheck = useCallback(() => {
    useSvRobotStore.getState().showTab('problems')
    void lint.refetch()
  }, [lint])

  const onBuild = useCallback(async () => {
    if (!flow) return
    try {
      const result = await build.mutateAsync({
        workflowId: flow.workflowId,
        mode,
        workflow: flow.workflow,
      })
      if (!result.ok || !result.build) {
        useSvRobotStore.getState().showTab('problems')
        const n = result.diagnostics.filter((d) => d.severity === 'error').length
        toast.error(
          t('robot.toast.buildFailed', {
            errors: svPlural(t, n, 'common.errors.one', 'common.errors.other'),
          })
        )
        return
      }
      useSvRobotStore.getState().setBuild(result.build.id)
      toast.success(t('robot.toast.built', { id: result.build.id.slice(0, 12) }))
    } catch (error) {
      toast.error(getErrorMessage(error, t('robot.toast.buildError')))
    }
  }, [flow, mode, t])

  const onDeploy = useCallback(async () => {
    if (!flow || !buildId) return
    try {
      const deployment = await deploy.mutateAsync({ workflowId: flow.workflowId, buildId, mode })
      useSvRobotStore.getState().setDeployment(deployment.id)
      toast.success(t('robot.toast.deployed', { robot: deployment.target.robotId ?? robotName }))
    } catch (error) {
      toast.error(getErrorMessage(error, t('robot.toast.deployError')))
    }
  }, [flow, buildId, mode, robotName, t])

  const onStart = useCallback(async () => {
    if (!flow || !deploymentId) return
    setConfirming(false)
    try {
      const started = await start.mutateAsync({ workflowId: flow.workflowId, deploymentId })
      useSvRobotStore.getState().setRun(started.id)
      useSvRobotStore.getState().showTab('live')
    } catch (error) {
      toast.error(getErrorMessage(error, t('robot.toast.startError')))
    }
  }, [flow, deploymentId, t])

  const onStop = useCallback(async () => {
    if (!runId) return
    try {
      const stopped = await stop.mutateAsync(runId)
      if (stopped.stop?.confirmed) toast.success(t('robot.toast.stopped'))
      else toast.error(t('robot.toast.stopUnconfirmed', { reason: stopped.stop?.message ?? '' }))
    } catch (error) {
      toast.error(getErrorMessage(error, t('robot.toast.stopError')))
    }
  }, [runId, t])

  const zooUrl = config.data?.zooUrl
  const zooHref = zooUrl ? `${zooUrl}${zooUrl.includes('?') ? '&' : '?'}lang=${locale}` : undefined

  return (
    <div
      data-sv='action-area'
      className='flex h-[36px] flex-shrink-0 items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-1)] px-2'
    >
      <div
        role='toolbar'
        aria-label={t('robot.bar.label')}
        data-sv='action-bar'
        data-rf-bar
        className='flex min-w-0 shrink-0 items-center gap-1'
      >
        <SvActionButton
          action='rf-check'
          label={t('robot.action.check')}
          icon={ShieldCheck}
          busy={lint.isFetching}
          busyLabel={t('robot.check.checking')}
          outcome={lint.isSuccess ? (errors ? 'failed' : 'passed') : null}
          disabled={!flow}
          onClick={onCheck}
          title={t('robot.action.checkTitle')}
        />
        <Badge
          size='sm'
          variant={errors ? 'red' : warnings ? 'amber' : 'green'}
          data-rf-check
          className='shrink-0'
        >
          {checkText}
        </Badge>
        <Separator />
        <SvActionButton
          action='rf-build'
          label={t('robot.action.build')}
          icon={Hammer}
          busy={build.isPending}
          busyLabel={t('robot.action.building')}
          primary={!buildId && !errors}
          disabled={!flow || errors > 0}
          onClick={onBuild}
          title={t('robot.action.buildTitle')}
          data={{ 'data-rf-action': 'build' }}
        />
        <SvActionButton
          action='rf-deploy'
          label={t('robot.action.deploy')}
          icon={Rocket}
          busy={deploy.isPending}
          busyLabel={t('robot.action.deploying')}
          primary={Boolean(buildId) && !deploymentId}
          disabled={!buildId || running || !robot}
          onClick={onDeploy}
          title={t('robot.action.deployTitle')}
          data={{ 'data-rf-action': 'deploy' }}
        />
        {running ? (
          <SvActionButton
            action='rf-stop'
            label={t('robot.action.stop')}
            icon={Square}
            busy={stop.isPending}
            primary
            onClick={onStop}
            title={t('robot.action.stopTitle')}
            data={{ 'data-rf-action': 'stop' }}
          />
        ) : confirming ? (
          <span className='flex items-center gap-1 text-caption' data-rf-confirm>
            {t('robot.confirm.question', { robot: robotName, mode: modeName })}
            <Button size='sm' variant='primary' data-rf-action='confirm-start' onClick={onStart}>
              <Check className='size-[14px]' /> {t('robot.confirm.start')}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              data-rf-action='cancel-start'
              onClick={() => setConfirming(false)}
            >
              {t('common.cancel')}
            </Button>
          </span>
        ) : (
          <SvActionButton
            action='rf-start'
            label={t('robot.action.start')}
            icon={Play}
            busy={start.isPending}
            primary={Boolean(deploymentId)}
            disabled={!deploymentId}
            onClick={() => setConfirming(true)}
            title={t('robot.action.startTitle')}
            data={{ 'data-rf-action': 'start' }}
          />
        )}
        <Separator />
        <SvActionButton
          action='rf-zoo'
          label='Robot Zoo'
          icon={ExternalLink}
          disabled={!zooHref}
          onClick={() => zooHref && window.open(zooHref, '_blank', 'noopener')}
          title={t('robot.action.zooTitle')}
          data={{ 'data-rf-action': 'zoo' }}
        />
        <Separator />
        <Button
          variant='ghost'
          size='sm'
          aria-pressed={details}
          data-sv-view='details'
          title={t('view.detailsTitle')}
          onClick={() => useSvCanvasViewStore.getState().setDetails(!details)}
          className={details ? 'bg-[var(--surface-active)]' : undefined}
        >
          <Rows3 className='size-[14px]' /> {t('view.details')}
        </Button>
        <Separator />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='sm'
              data-sv='robot-target'
              data-rf-target
              disabled={running}
              className='min-w-0 max-w-[320px] gap-1.5'
              title={t('robot.target.title')}
            >
              <Bot aria-hidden className='size-[14px] shrink-0' />
              <span className='truncate'>{targetLabel}</span>
              <ChevronDown aria-hidden className='size-[12px] shrink-0' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' sideOffset={4}>
            {MODES.map((m) => (
              <DropdownMenuItem
                key={m}
                data-rf-mode={m}
                onSelect={() => useSvRobotStore.getState().setMode(m)}
              >
                <Check
                  aria-hidden
                  className={m === mode ? 'size-[14px]' : 'size-[14px] opacity-0'}
                />
                {t(m === 'mock' ? 'robot.mode.mockLong' : 'robot.mode.rosSimLong')}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {pill && (
          <button
            type='button'
            data-sv='status-pill'
            data-sv-tone={pill.tone}
            onClick={() => useSvRobotStore.getState().showTab('live')}
            title={t('common.showDetails')}
            className='shrink-0'
          >
            <Badge
              variant={pill.tone === 'busy' ? 'blue' : pill.tone === 'ok' ? 'green' : 'red'}
              size='sm'
            >
              {pill.label}
            </Badge>
          </button>
        )}
      </div>
      {hint && (
        <p
          data-sv='action-hint'
          title={hint}
          className='min-w-0 flex-1 truncate text-right text-[12px] text-[var(--text-secondary)]'
        >
          {hint}
        </p>
      )}
    </div>
  )
}
