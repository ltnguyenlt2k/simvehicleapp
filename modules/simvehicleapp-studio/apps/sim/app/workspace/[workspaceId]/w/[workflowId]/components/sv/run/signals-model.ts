import type { SvScenario, SvSignalUpdate } from '@/lib/api/contracts/sv'

/** Signal paths the workflow uses (vehicle blocks carry a `path` prop), sorted. */
export function graphSignalPaths(graphJson: string | null): string[] {
  if (!graphJson) return []
  try {
    const graph = JSON.parse(graphJson) as { blocks?: { props?: { path?: unknown } }[] }
    const paths = new Set<string>()
    for (const b of graph.blocks ?? []) {
      if (typeof b.props?.path === 'string' && b.props.path.startsWith('Vehicle'))
        paths.add(b.props.path)
    }
    return [...paths].sort()
  } catch {
    return []
  }
}

/** What the user typed in an inject field: true/false, a number, a JSON array, else the text. */
export function parseSignalInput(text: string): SvScenario['inputs'][number]['value'] {
  const t = text.trim()
  if (t === 'true') return true
  if (t === 'false') return false
  if (t !== '' && Number.isFinite(Number(t))) return Number(t)
  if (t.startsWith('[')) {
    try {
      const v = JSON.parse(t) as unknown
      if (Array.isArray(v) && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) {
        return v as (string | number | boolean)[]
      }
    } catch {
      // not JSON: the text itself
    }
  }
  return text
}

export interface SignalValues {
  value?: SvSignalUpdate['value']
  target?: SvSignalUpdate['value']
  ts: number
}

/** Latest current value and target per path. */
export function applySignalUpdates(
  prev: Record<string, SignalValues>,
  updates: SvSignalUpdate[]
): Record<string, SignalValues> {
  const next = { ...prev }
  for (const u of updates) {
    const cur = next[u.path] ?? { ts: 0 }
    next[u.path] = { ...cur, [u.field]: u.value, ts: Math.max(cur.ts, u.ts) }
  }
  return next
}

export interface Recording {
  startedAt: number
  initial: Record<string, SvSignalUpdate['value']>
  inputs: { t: number; path: string; value: SvScenario['inputs'][number]['value'] }[]
}

/** Scenario v1 of a recording: current values at the start, then each injected value at its time. */
export function recordingToScenario(rec: Recording, name: string): SvScenario {
  const last = rec.inputs.at(-1)?.t ?? 0
  return {
    scenarioVersion: '1.0.0',
    name,
    until: Math.min(86_400_000, Math.max(1000, Math.ceil((last + 2000) / 1000) * 1000)),
    ...(Object.keys(rec.initial).length ? { initial: rec.initial } : {}),
    inputs: rec.inputs.map((i) => ({
      t: Math.min(86_400_000, Math.round(i.t)),
      path: i.path,
      value: i.value,
    })),
  }
}
