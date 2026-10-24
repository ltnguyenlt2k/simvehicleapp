'use client'

import { useCallback } from 'react'
import { FlaskConical, ShieldCheck } from 'lucide-react'
import { toast } from '@/components/emcn'
import {
  MyRunsMenu,
  RunButtons,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run'
import { defaultScenario } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { SvActionButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-button'
import { SvAppChip } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-app-chip'
import { SvStatusPill } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-status-pill'
import {
  ExportButton,
  OpenIdeButton,
  SynCodeButton,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode'
import { useSvActionStatus } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/use-sv-action-status'
import { useSvVerify } from '@/hooks/queries/sv-lint'
import { useSaveSvScenario, useSvScenario, useSvSimulate } from '@/hooks/queries/sv-simulation'
import { useUpdateSvTestCase } from '@/hooks/queries/sv-test-cases'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'
import { useSvTestStore } from '@/stores/sv/test/store'

/** A thin divider between the groups of the bar. */
function Separator() {
  return <div aria-hidden className='mx-1 h-4 w-px shrink-0 bg-[var(--border)]' />
}

/**
 * Workflow actions of the vehicle editor. Verify (M04-T11) runs every compiler check on the graph
 * on the canvas and shows the result in Problems; it is stale as soon as the canvas changes.
 * Simulate (M05-T10) compiles and runs the workflow's scenario on a virtual clock. SynCode (M07-T18)
 * generates, builds and tests the vehicle-app project of the workflow; Run/Stop (M08-T08) run its app
 * on the vehicle stack.
 *
 * The bar follows the work (ADR-0054, M16-T06): check (Verify, Simulate) │ generate and run (SynCode, Run, Stop) │
 * open and take out (Open IDE, Export), then the app the actions use and a status pill. The sensible next step is the
 * primary button; why an action cannot run is said in words in the bar, not only in a tooltip (inside the bar, not
 * a row under it: a row appearing with the first error would shift the canvas under the user's pointer).
 */
export function SvActionBar() {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const verifyStatus = useSvLintStore((s) => s.verifyStatus)
  const verifiedErrors = useSvLintStore((s) =>
    s.verifiedFresh ? s.diagnostics.filter((d) => d.severity === 'error').length : 0
  )
  const status = useSvActionStatus()
  const verify = useSvVerify()
  const workflowId = useSvLintStore((s) => s.workflowId)
  const simStatus = useSvSimulationStore((s) => s.status)
  const { data: scenario } = useSvScenario(workflowId ?? undefined)
  const simulate = useSvSimulate()
  const saveScenario = useSaveSvScenario(workflowId ?? undefined)
  const updateCase = useUpdateSvTestCase(workflowId ?? undefined)

  const onSimulate = useCallback(() => {
    const {
      graphJson: current,
      workflowId: wf,
      setVerified,
      showProblems,
    } = useSvLintStore.getState()
    if (!current || !wf) return
    const sim = useSvSimulationStore.getState()
    // What the editor shows (a draft may not be saved yet), else the saved scenario.
    const draft = sim.draft?.workflowId === wf ? sim.draft.scenario : null
    const run = draft ?? scenario ?? defaultScenario('Scenario')
    // The scenario that was simulated is the one kept with the workflow — in its test case (ADR-0058).
    const caseId = sim.draft?.workflowId === wf ? sim.draft.caseId : undefined
    if (draft && caseId) updateCase.mutate({ caseId, scenario: draft })
    else if (draft && draft !== scenario) saveScenario.mutate(draft)
    sim.setRunning()
    sim.showSimulation()
    simulate.mutate(
      { graphJson: current, scenario: run },
      {
        onSuccess: (response) => {
          if (!response.result) {
            // Does not compile: show why in Problems, like Verify.
            setVerified(current, response.diagnostics)
            useSvSimulationStore.getState().setFailed()
            showProblems()
            const errors = response.diagnostics.filter((d) => d.severity === 'error').length
            toast.error(`Simulate: fix ${errors} error${errors === 1 ? '' : 's'} first`)
            return
          }
          useSvSimulationStore.getState().setResult(wf, current, run.until, response.result)
          if (caseId) {
            const exp0 = response.result.expectations
            useSvTestStore.getState().setOutcome(caseId, {
              passed: exp0 ? exp0.passed : true,
              mismatches: exp0?.mismatches ?? [],
              graphJson: current,
              blockIds: [
                ...new Set(
                  response.result.trace.flatMap((e) =>
                    e.ev === 'enter' && e.blockId ? [e.blockId] : []
                  )
                ),
              ],
            })
          }
          const exp = response.result.expectations
          const writes = response.result.writes.length
          if (response.diagnostics.some((d) => d.code === 'SIM_LIMIT_REACHED'))
            toast.error('Simulation stopped at its event limit')
          else if (exp && !exp.passed)
            toast.error(`Simulated: ${exp.mismatches.length} expectation(s) not met`)
          else toast.success(`Simulated ${run.until} ms: ${writes} write${writes === 1 ? '' : 's'}`)
        },
        onError: () => {
          useSvSimulationStore.getState().setFailed()
          toast.error('Simulate is unavailable right now — try again in a moment')
        },
      }
    )
  }, [saveScenario, scenario, simulate, updateCase])

  const onVerify = useCallback(() => {
    const {
      graphJson: current,
      setVerified,
      setVerifyStatus,
      showProblems,
    } = useSvLintStore.getState()
    if (!current) return
    setVerifyStatus('verifying')
    verify.mutate(current, {
      onSuccess: (result) => {
        setVerified(current, result.diagnostics)
        showProblems()
        const errors = result.diagnostics.filter((d) => d.severity === 'error').length
        const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length
        if (errors) toast.error(`Verify: ${errors} error${errors === 1 ? '' : 's'} to fix`)
        else
          toast.success(
            warnings
              ? `Verify passed with ${warnings} warning${warnings === 1 ? '' : 's'}`
              : 'Verify passed'
          )
      },
      onError: () => {
        setVerifyStatus('unavailable')
        toast.error('Verify is unavailable right now — try again in a moment')
      },
    })
  }, [verify])

  const verifying = verifyStatus === 'verifying'
  const simulating = simStatus === 'running'
  return (
    <div
      data-sv='action-area'
      className='flex h-[36px] flex-shrink-0 items-center gap-2 border-[var(--border)] border-b bg-[var(--surface-1)] px-2'
    >
      <div
        role='toolbar'
        aria-label='Vehicle app actions'
        data-sv='action-bar'
        className='flex min-w-0 shrink-0 items-center gap-1'
      >
        <SvActionButton
          action='verify'
          label='Verify'
          icon={ShieldCheck}
          busy={verifying}
          busyLabel='Verifying…'
          outcome={verifyStatus === 'done' ? (verifiedErrors ? 'failed' : 'passed') : null}
          disabled={!graphJson}
          onClick={onVerify}
          title='Verify the workflow'
        />
        <SvActionButton
          action='simulate'
          label='Simulate'
          icon={FlaskConical}
          busy={simulating}
          busyLabel='Simulating…'
          outcome={simStatus === 'done' ? 'passed' : simStatus === 'failed' ? 'failed' : null}
          disabled={!graphJson}
          onClick={onSimulate}
          title='Simulate the workflow'
        />
        <Separator />
        <SynCodeButton primary={status.primary === 'syncode'} />
        <RunButtons primary={status.primary === 'run'} />
        <Separator />
        <OpenIdeButton />
        <ExportButton />
        <div className='ml-2 flex min-w-0 items-center gap-2'>
          <SvAppChip />
          <SvStatusPill pill={status.pill} />
          <MyRunsMenu />
        </div>
      </div>
      {status.hint && (
        <p
          data-sv='action-hint'
          title={status.hint}
          className='min-w-0 flex-1 truncate text-right text-[12px] text-[var(--text-secondary)]'
        >
          {status.hint}
        </p>
      )}
    </div>
  )
}
