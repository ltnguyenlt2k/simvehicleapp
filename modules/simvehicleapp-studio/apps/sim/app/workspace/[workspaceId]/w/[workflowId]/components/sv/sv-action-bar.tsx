'use client'

import { useCallback } from 'react'
import { Button, toast } from '@/components/emcn'
import { RunButtons } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/run'
import { defaultScenario } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sim/scenario-model'
import { SV_ACTIONS } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-config'
import { SynCodeButton } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/syncode'
import { useSvVerify } from '@/hooks/queries/sv-lint'
import { useSaveSvScenario, useSvScenario, useSvSimulate } from '@/hooks/queries/sv-simulation'
import { useSvLintStore } from '@/stores/sv/lint/store'
import { useSvSimulationStore } from '@/stores/sv/simulation/store'

/** Actions that work today; the others stay disabled until their milestone ships. */
const READY = new Set<string>(['verify', 'simulate', 'syncode', 'run', 'stop'])

/**
 * Workflow actions of the vehicle editor. Verify (M04-T11) runs every compiler check on the graph
 * on the canvas and shows the result in Problems; it is stale as soon as the canvas changes.
 * Simulate (M05-T10) compiles and runs the workflow's scenario on a virtual clock. SynCode (M07-T18)
 * generates, builds and tests the vehicle-app project of the workflow; Run/Stop (M08-T08) run its app
 * on the vehicle stack.
 */
export function SvActionBar() {
  const graphJson = useSvLintStore((s) => s.graphJson)
  const verifyStatus = useSvLintStore((s) => s.verifyStatus)
  const verify = useSvVerify()
  const workflowId = useSvLintStore((s) => s.workflowId)
  const simStatus = useSvSimulationStore((s) => s.status)
  const { data: scenario } = useSvScenario(workflowId ?? undefined)
  const simulate = useSvSimulate()
  const saveScenario = useSaveSvScenario(workflowId ?? undefined)

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
    // The scenario that was simulated is the one kept with the workflow.
    if (draft && draft !== scenario) saveScenario.mutate(draft)
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
  }, [saveScenario, scenario, simulate])

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

  return (
    <div
      role='toolbar'
      aria-label='Vehicle app actions'
      data-sv='action-bar'
      className='flex h-[36px] flex-shrink-0 items-center gap-1 border-[var(--border)] border-b bg-[var(--surface-1)] px-2'
    >
      {SV_ACTIONS.map((action) => {
        if (action.id === 'syncode') return <SynCodeButton key={action.id} />
        if (action.id === 'run') return <RunButtons key={action.id} />
        if (action.id === 'stop') return null
        const ready = READY.has(action.id)
        const busy =
          (action.id === 'verify' && verifyStatus === 'verifying') ||
          (action.id === 'simulate' && simStatus === 'running')
        return (
          <Button
            key={action.id}
            variant='ghost'
            size='sm'
            disabled={!ready || busy || !graphJson}
            data-sv-action={action.id}
            aria-busy={busy || undefined}
            onClick={
              action.id === 'verify' ? onVerify : action.id === 'simulate' ? onSimulate : undefined
            }
            title={
              ready
                ? `${action.label} the workflow`
                : `${action.label} — available in ${action.milestone}`
            }
          >
            {busy ? `${action.label === 'Verify' ? 'Verifying' : 'Simulating'}…` : action.label}
          </Button>
        )
      })}
    </div>
  )
}
