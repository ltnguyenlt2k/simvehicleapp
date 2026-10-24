/**
 * State of the vehicle editor's action bar (ADR-0054, M16-T06), derived — never stored — from what the lint,
 * simulation, SynCode and run stores and queries already hold: which action is the sensible next step (primary),
 * the status pill and the hint line under the bar. Pure, so every rule is unit-tested.
 */

export type SvPrimaryAction = 'syncode' | 'run' | null

/** The dock tab the pill brings forward. */
export type SvPillTarget = 'problems' | 'simulation' | 'build-log' | 'run-console'

export interface SvStatusPill {
  label: string
  tone: 'busy' | 'ok' | 'error'
  target: SvPillTarget
}

export interface SvActionStatusInput {
  /** The workflow is on the canvas and its graph was read. */
  loaded: boolean
  hasGraph: boolean
  /** Errors on the canvas right now (lint, adapter issues, or a fresh verify). */
  errors: number
  verifyStatus: 'idle' | 'verifying' | 'done' | 'unavailable'
  verifiedFresh: boolean
  simStatus: 'idle' | 'running' | 'done' | 'failed'
  project: { name: string; status: 'creating' | 'ready' | 'failed' } | null
  /** SynCode starts by itself once the app the user just created is ready. */
  preparing: boolean
  generation?: {
    state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
    stage?: string
    stages: { name: string; state: string }[]
  }
  /** The followed SynCode was made from the graph now on the canvas. */
  generationFresh: boolean
  run?: { state: 'starting' | 'running' | 'stopping' | 'stopped' | 'crashed'; runningAt?: number }
  /** An active deployment of the app (ADR-0060): its signals come from the target. */
  deployment?: { targetName: string; mode: 'read-only' | 'read-write' }
  now: number
}

export interface SvActionStatus {
  primary: SvPrimaryAction
  pill: SvStatusPill | null
  hint: string | null
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** `00:42`, `12:05`, `1:02:09`. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${two(m)}:${two(s % 60)}`
}

const ACTIVE_RUN = new Set(['starting', 'running', 'stopping'])

function pillOf(i: SvActionStatusInput): SvStatusPill | null {
  const run = i.run && ACTIVE_RUN.has(i.run.state) ? i.run : undefined
  if (run) {
    const label =
      run.state === 'running'
        ? `Running ${elapsed(i.now - (run.runningAt ?? i.now))}`
        : run.state === 'starting'
          ? 'Starting…'
          : 'Stopping…'
    return { label, tone: 'busy', target: 'run-console' }
  }
  if (i.deployment)
    return {
      label: `Deployed · ${i.deployment.targetName} · ${i.deployment.mode}`,
      tone: 'ok',
      target: 'run-console',
    }
  const g = i.generation
  if (g?.state === 'queued') return { label: 'SynCode queued', tone: 'busy', target: 'build-log' }
  if (g?.state === 'running') {
    const at = g.stages.findIndex((s) => s.state === 'running')
    const step = at >= 0 ? at + 1 : g.stages.filter((s) => s.state !== 'pending').length
    return {
      label: `Building · step ${Math.max(1, step)}/${g.stages.length}`,
      tone: 'busy',
      target: 'build-log',
    }
  }
  if (i.preparing) return { label: 'Preparing app…', tone: 'busy', target: 'build-log' }
  if (i.simStatus === 'running') return { label: 'Simulating…', tone: 'busy', target: 'simulation' }
  if (i.verifyStatus === 'verifying')
    return { label: 'Verifying…', tone: 'busy', target: 'problems' }
  if (i.run?.state === 'crashed')
    return { label: 'App crashed', tone: 'error', target: 'run-console' }
  if (g && i.generationFresh) {
    if (g.state === 'failed')
      return {
        label: `SynCode failed${g.stage ? ` at ${g.stage}` : ''}`,
        tone: 'error',
        target: 'build-log',
      }
    if (g.state === 'succeeded') return { label: 'Built ✓', tone: 'ok', target: 'build-log' }
  }
  if (i.verifiedFresh) {
    return i.errors
      ? { label: plural(i.errors, 'error'), tone: 'error', target: 'problems' }
      : { label: 'Verified ✓', tone: 'ok', target: 'problems' }
  }
  if (i.simStatus === 'failed')
    return { label: 'Simulate failed', tone: 'error', target: 'simulation' }
  return null
}

function hintOf(i: SvActionStatusInput): string | null {
  if (!i.loaded || !i.hasGraph) return null
  if (i.errors)
    return `Fix ${plural(i.errors, 'problem')} before SynCode — they are listed in Problems.`
  if (!i.project) return 'No vehicle app yet: press SynCode to create one for this workflow.'
  if (i.project.status === 'creating' && !i.preparing)
    return `${i.project.name} is being prepared; SynCode is possible once it is ready.`
  if (i.project.status === 'failed')
    return `${i.project.name} could not be prepared: repair it in Vehicle apps.`
  return null
}

function primaryOf(i: SvActionStatusInput): SvPrimaryAction {
  // Nothing to push forward while the canvas has errors (the hint says so) or the app is running.
  if (!i.hasGraph || i.errors || (i.run && ACTIVE_RUN.has(i.run.state))) return null
  const built = i.generation?.state === 'succeeded' && i.generationFresh
  return i.project?.status === 'ready' && built ? 'run' : 'syncode'
}

export function deriveSvActionStatus(i: SvActionStatusInput): SvActionStatus {
  return { primary: primaryOf(i), pill: pillOf(i), hint: hintOf(i) }
}
