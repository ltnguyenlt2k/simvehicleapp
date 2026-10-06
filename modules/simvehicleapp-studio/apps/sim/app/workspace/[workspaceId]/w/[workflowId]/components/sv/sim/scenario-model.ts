import yaml from 'js-yaml'
import {
  type SvScenario,
  type SvSimulateResponse,
  type SvTraceEvent,
  svScenarioSchema,
} from '@/lib/api/contracts/sv'

/**
 * Pure helpers of the Simulate UI (M05-T09/T10): scenario defaults and YAML exchange (contracts
 * `scenario` v1), the timeline rows and the replay state of each block at a virtual time.
 */

/** A scenario a new workflow simulates with: 10 s, no inputs (app start/timers still run). */
export function defaultScenario(name: string): SvScenario {
  return { scenarioVersion: '1.0.0', name: name || 'Scenario', until: 10_000, inputs: [] }
}

export function scenarioToYaml(scenario: SvScenario): string {
  return yaml.dump(scenario, { lineWidth: 120, noRefs: true, sortKeys: false })
}

export type ScenarioParse = { ok: true; scenario: SvScenario } | { ok: false; error: string }

/** Parses YAML (or JSON) text into a scenario validated against the contract. */
export function scenarioFromYaml(text: string): ScenarioParse {
  let raw: unknown
  try {
    raw = yaml.load(text, { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    return { ok: false, error: `Not valid YAML: ${(error as Error).message.split('\n')[0]}` }
  }
  const parsed = svScenarioSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: `${issue?.path.join('.') || 'scenario'}: ${issue?.message ?? 'invalid'}`,
    }
  }
  return { ok: true, scenario: parsed.data }
}

/** A cell typed in the editor ⇒ scenario value: JSON when it parses (numbers, true, "text", [..]), else text. */
export function parseCell(text: string): SvScenario['inputs'][number]['value'] {
  const t = text.trim()
  if (t === '') return ''
  try {
    const v = JSON.parse(t) as unknown
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
      return v as string | number | boolean | null
    if (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) {
      return v as (string | number | boolean)[]
    }
  } catch {
    // plain text
  }
  return t
}

export function formatCell(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export type TimelineKind = 'input' | 'write' | 'trigger' | 'log' | 'publish' | 'error' | 'cancel'

export interface TimelineRow {
  t: number
  kind: TimelineKind
  label: string
  detail: string
  blockId?: string
  run?: number
}

/** Rows of the Simulation timeline in time order (stable for events at the same instant). */
export function timelineRows(result: NonNullable<SvSimulateResponse['result']>): TimelineRow[] {
  const rows: (TimelineRow & { order: number })[] = []
  let order = 0
  for (const s of result.signals)
    rows.push({ t: s.t, kind: 'input', label: s.path, detail: formatCell(s.value), order: order++ })
  for (const e of result.trace) {
    const base = { t: e.ts, blockId: e.blockId, run: e.run, order: order++ }
    if (e.ev === 'write')
      rows.push({
        ...base,
        kind: 'write',
        label: String(e.data?.path),
        detail: formatCell(e.data?.value),
      })
    else if (e.ev === 'trigger')
      rows.push({ ...base, kind: 'trigger', label: `run ${e.run}`, detail: 'started' })
    else if (e.ev === 'error')
      rows.push({
        ...base,
        kind: 'error',
        label: String(e.data?.reason ?? 'error'),
        detail: String(e.data?.message ?? ''),
      })
    else if (e.ev === 'cancel')
      rows.push({
        ...base,
        kind: 'cancel',
        label: `run ${e.run}`,
        detail: `cancelled (${String(e.data?.reason ?? '')})`,
      })
    else if (e.ev === 'value' && e.data?.kind === 'log')
      rows.push({
        ...base,
        kind: 'log',
        label: String(e.data?.level),
        detail: String(e.data?.message),
      })
    else if (e.ev === 'value' && e.data?.kind === 'mqtt')
      rows.push({
        ...base,
        kind: 'publish',
        label: String(e.data?.topic),
        detail: String(e.data?.payload),
      })
  }
  return rows.sort((a, b) => a.t - b.t || a.order - b.order).map(({ order: _order, ...r }) => r)
}

export type BlockReplayState = 'running' | 'done' | 'error'

export interface BlockReplay {
  state: BlockReplayState
  /** Times the block finished up to the cursor. */
  runs: number
  /** Last value the block wrote, logged or published up to the cursor. */
  last?: string
}

/** What each block was doing at virtual time `at` (TraceOverlay, reused for live runs in M8). */
export function replayAt(trace: readonly SvTraceEvent[], at: number): Record<string, BlockReplay> {
  const out: Record<string, BlockReplay> = {}
  const open = new Map<string, number>()
  for (const e of trace) {
    if (e.ts > at) break
    if (!e.blockId) continue
    const key = `${e.blockId}\u0000${e.run ?? 0}`
    const s = (out[e.blockId] ??= { state: 'done', runs: 0 })
    if (e.ev === 'enter') {
      open.set(key, (open.get(key) ?? 0) + 1)
      s.state = 'running'
    } else if (e.ev === 'exit' || e.ev === 'cancel') {
      open.set(key, Math.max(0, (open.get(key) ?? 1) - 1))
      if (e.ev === 'exit') s.runs++
      s.state = [...open.entries()].some(([k, n]) => n > 0 && k.startsWith(`${e.blockId}\u0000`))
        ? 'running'
        : 'done'
    } else if (e.ev === 'error') s.state = 'error'
    if (e.ev === 'write') s.last = formatCell(e.data?.value)
    if (e.ev === 'value') s.last = String(e.data?.message ?? e.data?.payload ?? '')
  }
  return out
}
