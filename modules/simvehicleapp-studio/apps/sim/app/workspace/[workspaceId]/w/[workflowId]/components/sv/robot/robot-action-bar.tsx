'use client'

import { useCallback, useMemo, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { Bot, ExternalLink, Hammer, Play, Rocket, ShieldCheck, Square } from 'lucide-react'
import { Button, toast } from '@/components/emcn'
import type { SvRobotMode } from '@/lib/api/contracts/sv-robotics'
import { cn } from '@/lib/core/utils/cn'
import { useRobotFlow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/robot/use-robot-flow'
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
import { useSvRobotStore } from '@/stores/sv/robot/store'

const MODES: { id: SvRobotMode; label: string; title: string }[] = [
  { id: 'mock', label: 'Mock', title: 'Mô phỏng nhẹ (Protobus mock), không cần ROS' },
  { id: 'ros-sim', label: 'Dog ROS sim', title: 'Robot dog mô phỏng thật qua Protobus → ROS 2' },
]

function Separator() {
  return <div aria-hidden className='mx-1 h-4 w-px shrink-0 bg-[var(--border)]' />
}

/**
 * Actions of a robot workflow (ADR-0068 §5): check │ build → deploy → start/stop │ Robot Zoo. Every step is explicit:
 * deploy never starts, Start asks for confirmation naming the robot, Stop is always available while a run is active.
 */
export function RobotActionBar() {
  const flow = useRobotFlow()
  const mode = useSvRobotStore((s) => s.mode)
  const buildId = useSvRobotStore((s) => s.buildId)
  const deploymentId = useSvRobotStore((s) => s.deploymentId)
  const runId = useSvRobotStore((s) => s.runId)
  const setMode = useSvRobotStore((s) => s.setMode)
  const setBuild = useSvRobotStore((s) => s.setBuild)
  const setDeployment = useSvRobotStore((s) => s.setDeployment)
  const setRun = useSvRobotStore((s) => s.setRun)
  const [confirming, setConfirming] = useState(false)

  const debounced = useDebounce(flow?.json, 400)
  const lint = useSvRobotLint(flow?.workflowId, mode, debounced)
  const config = useSvRobotConfig(true)
  const run = useSvRobotRun(runId ?? undefined)
  const build = useSvRobotBuild()
  const deploy = useSvRobotDeploy()
  const start = useSvRobotStart()
  const stop = useSvRobotStop()

  const errors =
    (lint.data?.diagnostics ?? []).filter((d) => d.severity === 'error').length +
    (flow?.issues.length ?? 0)
  const warnings = (lint.data?.diagnostics ?? []).filter((d) => d.severity === 'warning').length
  const running = run.data?.state === 'running'
  const target = config.data?.targets.find((t) => t.mode === mode)
  const targetLabel = useMemo(() => {
    if (!target) return 'đang kiểm tra robot…'
    if ('error' in target) return 'robot chưa sẵn sàng'
    return `${target.robotId ?? '?'} · ${target.robotMode ?? '?'}${target.scene ? ` · ${target.scene}` : ''}`
  }, [target])

  const onBuild = useCallback(async () => {
    if (!flow) return
    try {
      const result = await build.mutateAsync({
        workflowId: flow.workflowId,
        mode,
        workflow: flow.workflow,
      })
      if (!result.ok || !result.build) {
        toast.error(
          `Build thất bại: ${result.diagnostics.filter((d) => d.severity === 'error').length} lỗi`
        )
        return
      }
      setBuild(result.build.id)
      toast.success(`Build xong: app Python ${result.build.id.slice(0, 12)}`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Build thất bại'))
    }
  }, [flow, mode, setBuild])

  const onDeploy = useCallback(async () => {
    if (!flow || !buildId) return
    try {
      const deployment = await deploy.mutateAsync({ workflowId: flow.workflowId, buildId, mode })
      setDeployment(deployment.id)
      toast.success(`Đã deploy lên ${deployment.target.robotId ?? 'robot'} (${mode}); chưa chạy`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Deploy thất bại'))
    }
  }, [flow, buildId, mode, setDeployment])

  const onStart = useCallback(async () => {
    if (!flow || !deploymentId) return
    setConfirming(false)
    try {
      const started = await start.mutateAsync({ workflowId: flow.workflowId, deploymentId })
      setRun(started.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Start thất bại'))
    }
  }, [flow, deploymentId, setRun])

  const onStop = useCallback(async () => {
    if (!runId) return
    try {
      const stopped = await stop.mutateAsync(runId)
      if (stopped.stop?.confirmed) toast.success('Robot đã dừng (SAFE_STOP xác nhận)')
      else toast.error(`Stop chưa được robot xác nhận: ${stopped.stop?.message ?? ''}`)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Stop thất bại'))
    }
  }, [runId])

  return (
    <div
      className='flex h-[40px] shrink-0 items-center gap-1 overflow-x-auto border-[var(--border)] border-b bg-[var(--surface-2)] px-2'
      data-rf-bar
    >
      <Bot className='size-[14px] text-[var(--text-icon)]' />
      <span className='text-[var(--text-secondary)] text-small'>Robot</span>
      {MODES.map((m) => (
        <Button
          key={m.id}
          size='sm'
          variant={mode === m.id ? 'active' : 'ghost'}
          title={m.title}
          aria-pressed={mode === m.id}
          data-rf-mode={m.id}
          disabled={running}
          onClick={() => setMode(m.id)}
        >
          {m.label}
        </Button>
      ))}
      <span className='truncate text-[var(--text-muted)] text-caption' data-rf-target>
        {targetLabel}
      </span>
      <Separator />
      <span
        className={cn(
          'flex items-center gap-1 text-caption',
          errors ? 'text-[var(--text-error)]' : 'text-[var(--text-secondary)]'
        )}
        data-rf-check
        title='Kiểm tra RobotFlow (compiler) chạy tự động khi sửa'
      >
        <ShieldCheck className='size-[14px]' />
        {lint.isFetching
          ? 'Đang kiểm tra…'
          : errors
            ? `${errors} lỗi`
            : warnings
              ? `OK · ${warnings} cảnh báo`
              : 'OK'}
      </span>
      <Separator />
      <Button
        size='sm'
        variant='default'
        data-rf-action='build'
        disabled={!flow || errors > 0 || build.isPending}
        onClick={onBuild}
      >
        <Hammer className='size-[14px]' /> {build.isPending ? 'Đang build…' : 'Build'}
      </Button>
      <Button
        size='sm'
        variant='default'
        data-rf-action='deploy'
        disabled={!buildId || deploy.isPending || running}
        onClick={onDeploy}
      >
        <Rocket className='size-[14px]' /> Deploy
      </Button>
      {running ? (
        <Button
          size='sm'
          variant='destructive'
          data-rf-action='stop'
          disabled={stop.isPending}
          onClick={onStop}
        >
          <Square className='size-[14px]' /> Stop
        </Button>
      ) : confirming ? (
        <span className='flex items-center gap-1 text-caption' data-rf-confirm>
          Start sẽ điều khiển {target && !('error' in target) ? target.robotId : 'robot'} ({mode})?
          <Button size='sm' variant='primary' data-rf-action='confirm-start' onClick={onStart}>
            Xác nhận Start
          </Button>
          <Button size='sm' variant='ghost' onClick={() => setConfirming(false)}>
            Huỷ
          </Button>
        </span>
      ) : (
        <Button
          size='sm'
          variant='primary'
          data-rf-action='start'
          disabled={!deploymentId || start.isPending}
          onClick={() => setConfirming(true)}
        >
          <Play className='size-[14px]' /> Start
        </Button>
      )}
      <Separator />
      <Button
        size='sm'
        variant='ghost'
        data-rf-action='zoo'
        disabled={!config.data?.zooUrl}
        title='Mở Robot Zoo (repo dog) ở tab mới để xem robot 3D'
        onClick={() => window.open(config.data?.zooUrl, '_blank', 'noopener')}
      >
        <ExternalLink className='size-[14px]' /> Robot Zoo
      </Button>
    </div>
  )
}
