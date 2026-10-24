import { describe, expect, it } from 'vitest'
import {
  deriveSvActionStatus,
  elapsed,
  type SvActionStatusInput,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/sv/sv-action-status'

const base: SvActionStatusInput = {
  loaded: true,
  hasGraph: true,
  errors: 0,
  verifyStatus: 'idle',
  verifiedFresh: false,
  simStatus: 'idle',
  project: { name: 'Hazard', status: 'ready' },
  preparing: false,
  generationFresh: false,
  now: 100_000,
}
const stages = (running: number) =>
  ['ir', 'codegen', 'write', 'deps', 'build', 'format-check', 'test'].map((name, i) => ({
    name,
    state: i < running ? 'passed' : i === running ? 'running' : 'pending',
  }))
const derive = (over: Partial<SvActionStatusInput>) => deriveSvActionStatus({ ...base, ...over })

describe('action bar status (ADR-0054)', () => {
  it('SynCode is the next step until a build of this graph exists, then Run', () => {
    expect(derive({}).primary).toBe('syncode')
    expect(derive({ project: null }).primary).toBe('syncode')
    const built = { state: 'succeeded' as const, stages: stages(7) }
    expect(derive({ generation: built, generationFresh: true }).primary).toBe('run')
    // The canvas changed after the build: SynCode again.
    expect(derive({ generation: built, generationFresh: false }).primary).toBe('syncode')
    // A failed app cannot run.
    expect(
      derive({ generation: built, generationFresh: true, project: { name: 'H', status: 'failed' } })
        .primary
    ).toBe('syncode')
  })

  it('nothing is primary while the canvas has errors, the app runs or there is no graph', () => {
    expect(derive({ errors: 2 }).primary).toBeNull()
    expect(derive({ run: { state: 'running', runningAt: 0 } }).primary).toBeNull()
    expect(derive({ hasGraph: false }).primary).toBeNull()
  })

  it('a deployment shows its target and mode; a test run of the app at the same time comes first (ADR-0060)', () => {
    const deployment = { targetName: 'HIL bench', mode: 'read-only' as const }
    expect(derive({ deployment }).pill).toEqual({
      label: 'Deployed · HIL bench · read-only',
      tone: 'ok',
      target: 'run-console',
    })
    expect(derive({ deployment, run: { state: 'running', runningAt: 58_000 } }).pill?.label).toBe(
      'Running 00:42'
    )
  })

  it('the pill shows what is happening, the most important first', () => {
    expect(derive({ run: { state: 'running', runningAt: 58_000 } }).pill).toEqual({
      label: 'Running 00:42',
      tone: 'busy',
      target: 'run-console',
    })
    expect(derive({ generation: { state: 'running', stages: stages(2) } }).pill?.label).toBe(
      'Building · step 3/7'
    )
    expect(derive({ generation: { state: 'queued', stages: stages(-1) } }).pill?.label).toBe(
      'SynCode queued'
    )
    expect(derive({ preparing: true }).pill?.label).toBe('Preparing app…')
    expect(derive({ simStatus: 'running' }).pill).toMatchObject({ target: 'simulation' })
    expect(derive({ verifyStatus: 'verifying' }).pill?.label).toBe('Verifying…')
    expect(derive({ run: { state: 'crashed' } }).pill).toMatchObject({ tone: 'error' })
  })

  it('a finished SynCode or Verify of this graph leaves its outcome in the pill', () => {
    expect(
      derive({
        generation: { state: 'failed', stage: 'build', stages: stages(4) },
        generationFresh: true,
      }).pill
    ).toEqual({ label: 'SynCode failed at build', tone: 'error', target: 'build-log' })
    expect(
      derive({ generation: { state: 'succeeded', stages: stages(7) }, generationFresh: true }).pill
        ?.label
    ).toBe('Built ✓')
    // An outdated outcome is not shown.
    expect(
      derive({ generation: { state: 'failed', stages: stages(4) }, generationFresh: false }).pill
    ).toBeNull()
    expect(derive({ verifiedFresh: true }).pill?.label).toBe('Verified ✓')
    expect(derive({ verifiedFresh: true, errors: 1 }).pill).toEqual({
      label: '1 error',
      tone: 'error',
      target: 'problems',
    })
    expect(derive({ simStatus: 'failed' }).pill?.label).toBe('Simulate failed')
    expect(derive({}).pill).toBeNull()
  })

  it('the hint says why the next step is not possible, in words', () => {
    expect(derive({ errors: 3 }).hint).toBe(
      'Fix 3 problems before SynCode — they are listed in Problems.'
    )
    expect(derive({ project: null }).hint).toBe(
      'No vehicle app yet: press SynCode to create one for this workflow.'
    )
    expect(derive({ project: { name: 'Hazard', status: 'creating' } }).hint).toContain(
      'being prepared'
    )
    // The pill already says it is being prepared for SynCode.
    expect(
      derive({ project: { name: 'Hazard', status: 'creating' }, preparing: true }).hint
    ).toBeNull()
    expect(derive({ project: { name: 'Hazard', status: 'failed' } }).hint).toContain('repair')
    expect(derive({ loaded: false, project: null }).hint).toBeNull()
    expect(derive({}).hint).toBeNull()
  })

  it('formats elapsed time', () => {
    expect(elapsed(42_000)).toBe('00:42')
    expect(elapsed(725_000)).toBe('12:05')
    expect(elapsed(3_729_000)).toBe('1:02:09')
    expect(elapsed(-5)).toBe('00:00')
  })
})
