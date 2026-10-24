'use client'

import { useMemo, useState } from 'react'
import { Rocket } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import type { SvDeployMode, SvTestDeployTargetResult } from '@/lib/api/contracts/sv'
import { graphSignalPaths } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/signals-model'
import { useWorkflowRuns } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run/use-run-follow'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import {
  useCreateSvDeployTarget,
  useStartSvDeployment,
  useSvDeployTargets,
  useTestSvDeployTarget,
} from '@/hooks/queries/sv-deploy'
import { useStopSvRun } from '@/hooks/queries/sv-runs'
import { useSvLintStore } from '@/stores/sv/lint/store'

const NEW_TARGET = '__new__'

/** Actuators the workflow sets (Set blocks): what a read-write deployment lets it change on the target. */
function writtenActuators(graphJson: string | null): string[] {
  if (!graphJson) return []
  try {
    const g = JSON.parse(graphJson) as { blocks?: { type?: string; props?: { path?: unknown } }[] }
    const paths = (g.blocks ?? []).flatMap((b) =>
      b.type === 'sv_set_actuator' && typeof b.props?.path === 'string' ? [b.props.path] : []
    )
    return [...new Set(paths)].sort()
  } catch {
    return []
  }
}

/** The result of Test connection in words. */
function testedText(r: SvTestDeployTargetResult): string {
  if (!r.reachable) return `Not reachable: ${r.message} (gRPC status ${r.status})`
  const server = [r.server.name, r.server.version].filter(Boolean).join(' ')
  return r.missing.length
    ? `Reachable (${server}), but it lacks ${r.missing.length} signal(s) this workflow uses: ${r.missing.join(', ')}`
    : `Reachable (${server}); it has every signal this workflow uses`
}

/**
 * Deploy (ADR-0060, M18-T09): runs the app of the latest SynCode on a deploy target — a databroker outside the stack
 * whose signals come from the vehicle's layers (CAN, hardware). Simulated input (inject, Play, Record) is disabled
 * while deployed; read-only by default, read-write (the app sets its own actuators on the target) for workspace
 * admins after a confirmation listing them.
 */
export function DeployButton() {
  const { project, deployment } = useWorkflowRuns()
  const [open, setOpen] = useState(false)
  const ready = project?.status === 'ready'
  return (
    <>
      <SvActionButton
        action='deploy'
        label={deployment ? 'Deployed' : 'Deploy'}
        icon={Rocket}
        disabled={!ready}
        onClick={() => setOpen(true)}
        title={
          !project
            ? 'Press SynCode first: it creates the vehicle app of this workflow'
            : deployment?.deploy
              ? `${project.name} is deployed to ${deployment.deploy.targetName} (${deployment.deploy.mode})`
              : `Deploy ${project.name} to a vehicle databroker`
        }
      />
      {open && project && <DeployModal open={open} onOpenChange={setOpen} />}
    </>
  )
}

interface DeployModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function DeployModal({ open, onOpenChange }: DeployModalProps) {
  const { project, deployment } = useWorkflowRuns()
  const graphJson = useSvLintStore((s) => s.graphJson)
  const workspaceId = useParams<{ workspaceId?: string }>()?.workspaceId
  const { data: targets = [] } = useSvDeployTargets(workspaceId)
  const sameRelease = targets.filter((t) => t.vssRelease === project?.vssRelease)
  const [targetId, setTargetId] = useState<string>(sameRelease[0]?.id ?? NEW_TARGET)
  const [mode, setMode] = useState<SvDeployMode>('read-only')
  const [confirmWrite, setConfirmWrite] = useState(false)
  const [draft, setDraft] = useState({ name: '', address: '', tls: 'no', token: '' })
  const [tested, setTested] = useState<SvTestDeployTargetResult | null>(null)
  const create = useCreateSvDeployTarget()
  const test = useTestSvDeployTarget()
  const start = useStartSvDeployment()
  const stop = useStopSvRun()
  const paths = useMemo(() => graphSignalPaths(graphJson), [graphJson])
  const actuators = useMemo(() => writtenActuators(graphJson), [graphJson])
  const isNew = targetId === NEW_TARGET || !sameRelease.some((t) => t.id === targetId)

  if (!project || !workspaceId) return null

  if (deployment?.deploy) {
    return (
      <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Deployment'>
        <ChipModalHeader onClose={() => onOpenChange(false)}>Deployed</ChipModalHeader>
        <ChipModalBody>
          <p data-sv='deploy-status' className='px-2 text-[var(--text-secondary)] text-small'>
            {project.name} runs on {deployment.deploy.targetName} ({deployment.deploy.mode}). Its
            signals come from the target; inject, Play and Record are disabled while it is deployed.
          </p>
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => onOpenChange(false)}
          primaryAction={{
            label: stop.isPending ? 'Stopping...' : 'Stop deployment',
            onClick: () =>
              stop.mutate(
                { projectId: project.id, runId: deployment.id },
                {
                  onSuccess: () => onOpenChange(false),
                  onError: (e) => toast.error(`Stop: ${e.message}`),
                }
              ),
            disabled: stop.isPending,
          }}
        />
      </ChipModal>
    )
  }

  /** The chosen target, created first when it is a new one. */
  const resolveTarget = async (): Promise<string | null> => {
    if (!isNew) return targetId
    try {
      const t = await create.mutateAsync({
        workspaceId,
        name: draft.name.trim(),
        address: draft.address.trim(),
        tls: draft.tls === 'yes',
        ...(draft.token ? { token: draft.token } : {}),
        vssRelease: project.vssRelease,
      })
      setTargetId(t.id)
      return t.id
    } catch (e) {
      toast.error(`Deploy target: ${(e as Error).message}`)
      return null
    }
  }

  const onTest = async () => {
    const id = await resolveTarget()
    if (!id) return
    test.mutate(
      { id, workspaceId, paths },
      { onSuccess: setTested, onError: (e) => toast.error(e.message) }
    )
  }

  const onDeploy = async () => {
    const id = await resolveTarget()
    if (!id) return
    start.mutate(
      { projectId: project.id, targetId: id, mode },
      {
        onSuccess: (run) => {
          toast.success(
            `${project.name} deployed to ${run.deploy?.targetName ?? 'the target'} (${mode})`
          )
          onOpenChange(false)
        },
        onError: (e) => toast.error(`Deploy: ${e.message}`),
      }
    )
  }

  const busy = create.isPending || test.isPending || start.isPending
  const draftOk =
    !isNew || (draft.name.trim() && /^[A-Za-z0-9.-]{1,253}:[0-9]{2,5}$/.test(draft.address.trim()))
  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Deploy'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Deploy {project.name}</ChipModalHeader>
      <ChipModalBody>
        <p className='px-2 text-[var(--text-secondary)] text-small'>
          Run means testing with simulated signals. Deploy runs the app on a vehicle databroker
          whose signals come from the car's own layers (CAN, hardware): inject, Play and Record are
          disabled there.
        </p>
        <ChipModalField
          type='dropdown'
          title='Target'
          value={isNew ? NEW_TARGET : targetId}
          onChange={(v) => {
            setTargetId(v)
            setTested(null)
          }}
          options={[
            ...sameRelease.map((t) => ({
              value: t.id,
              label: `${t.name} — ${t.address}${t.tls ? ' (TLS)' : ''}`,
            })),
            { value: NEW_TARGET, label: 'Add a deploy target…' },
          ]}
          hint={`Targets of VSS ${project.vssRelease}, the release of this app.`}
        />
        {isNew && (
          <ChipModalField
            type='input'
            title='Name'
            value={draft.name}
            onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
            placeholder='HIL bench'
            maxLength={80}
            required
          />
        )}
        {isNew && (
          <ChipModalField
            type='input'
            title='Databroker address'
            value={draft.address}
            onChange={(v) => setDraft((d) => ({ ...d, address: v }))}
            placeholder='bench.lab:55555'
            maxLength={260}
            required
            hint='host:port of the KUKSA databroker (kuksa.val.v2). Only workspace admins add targets.'
          />
        )}
        {isNew && (
          <ChipModalField
            type='dropdown'
            title='TLS'
            value={draft.tls}
            onChange={(v) => setDraft((d) => ({ ...d, tls: v }))}
            options={[
              { value: 'no', label: 'No (lab network)' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
        )}
        {isNew && (
          <ChipModalField
            type='input'
            inputType='password'
            title='Token'
            value={draft.token}
            onChange={(v) => setDraft((d) => ({ ...d, token: v }))}
            placeholder='optional'
            maxLength={4096}
            hint='Sent to the target as a bearer token; stored encrypted, never shown again.'
          />
        )}
        <ChipModalField type='custom' title='Test connection'>
          <div className='flex flex-col items-start gap-1'>
            <Button
              size='sm'
              variant='ghost'
              data-sv='deploy-test'
              disabled={busy || !draftOk}
              onClick={() => void onTest()}
            >
              {test.isPending ? 'Testing...' : 'Test connection'}
            </Button>
            {tested && (
              <span
                data-sv='deploy-tested'
                data-sv-reachable={tested.reachable}
                className={
                  tested.reachable && !tested.missing.length
                    ? 'text-[var(--text-success)] text-small'
                    : 'text-[var(--text-error)] text-small'
                }
              >
                {testedText(tested)}
              </span>
            )}
          </div>
        </ChipModalField>
        <ChipModalField
          type='dropdown'
          title='Mode'
          value={mode}
          onChange={(v) => {
            setMode(v as SvDeployMode)
            setConfirmWrite(false)
          }}
          options={[
            { value: 'read-only', label: 'Read-only — the app only reads the target (safe)' },
            { value: 'read-write', label: 'Read-write — the app may set its actuators (admins)' },
          ]}
        />
        {mode === 'read-write' && (
          <ChipModalField
            type='custom'
            title='The app will be able to set'
            hint='Only these actuators; every write is audited.'
          >
            <label className='flex items-start gap-2 text-[var(--text-primary)] text-small'>
              <input
                type='checkbox'
                checked={confirmWrite}
                onChange={(e) => setConfirmWrite(e.target.checked)}
                data-sv='deploy-confirm-write'
              />
              <span>
                {actuators.length ? actuators.join(', ') : 'no actuator (the workflow sets none)'}
              </span>
            </label>
          </ChipModalField>
        )}
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={busy}
        primaryAction={{
          label: start.isPending ? 'Deploying...' : 'Deploy',
          onClick: () => void onDeploy(),
          disabled: busy || !draftOk || (mode === 'read-write' && !confirmWrite),
        }}
      />
    </ChipModal>
  )
}
