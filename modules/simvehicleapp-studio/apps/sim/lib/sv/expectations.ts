import type { SvPlayback, SvScenario } from '@/lib/api/contracts/sv'

/** On the vehicle stack a write lands a little after its virtual time: default tolerance (ADR-0058 §9). */
export const PLAY_WITHIN_MS = 300

export interface PlayGrade {
  passed: boolean
  mismatches: string[]
  /** Lag of each matched expected write (ms after its time). */
  drifts: number[]
}

/** Signals to observe while a case plays: what it expects written or never written. */
export function observedPaths(scenario: SvScenario): string[] {
  const e = scenario.expect
  return [
    ...new Set([...(e?.writes ?? []).map((w) => w.path), ...(e?.never ?? []).map((n) => n.path)]),
  ].sort()
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Grades a case against what the app did on the vehicle stack (Play, ADR-0058 §4), with scenario 1.1 rules:
 * expectations are a subset matched in order, each write within its `within` (default {@link PLAY_WITHIN_MS} here,
 * since real timing drifts), `never` forbids a write; target and current changes both count as the app's write
 * (sdv.databroker.v1 sets the target, kuksa.val.v2 the current value through the provider).
 */
export function gradePlayback(
  scenario: SvScenario,
  playback: Pick<SvPlayback, 'observed'>,
  defaultWithin = PLAY_WITHIN_MS
): PlayGrade {
  const observed = [...(playback.observed ?? [])].sort((a, b) => a.t - b.t)
  const mismatches: string[] = []
  const drifts: number[] = []
  const used = new Set<number>()
  let start = 0
  for (const w of scenario.expect?.writes ?? []) {
    const within = w.within ?? defaultWithin
    const i = observed.findIndex(
      (o, j) =>
        j >= start &&
        !used.has(j) &&
        o.path === w.path &&
        same(o.value, w.value) &&
        o.t >= w.t &&
        o.t <= w.t + within
    )
    if (i < 0) {
      const seen = observed
        .filter((o) => o.path === w.path)
        .map((o) => `${JSON.stringify(o.value)} at ${o.t} ms`)
      mismatches.push(
        `expected ${w.path} = ${JSON.stringify(w.value)} at ${w.t} ms (within ${within} ms); seen ${seen.length ? seen.join(', ') : 'nothing'}`
      )
      continue
    }
    used.add(i)
    drifts.push(observed[i].t - w.t)
    start = i + 1
  }
  for (const n of scenario.expect?.never ?? []) {
    const hit = observed.find(
      (o) => o.path === n.path && o.t >= (n.from ?? 0) && (n.to === undefined || o.t <= n.to)
    )
    if (hit)
      mismatches.push(
        `${n.path} must not be written: written ${JSON.stringify(hit.value)} at ${hit.t} ms`
      )
  }
  return { passed: mismatches.length === 0, mismatches, drifts }
}
