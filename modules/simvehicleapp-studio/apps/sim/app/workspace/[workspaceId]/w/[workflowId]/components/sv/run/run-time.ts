/** A run warns this long before its time limit and offers Extend (ADR-0057). */
export const RUN_EXPIRY_WARN_MS = 5 * 60_000

/** "12 min", "45 s": time left until a sandboxed run stops by itself; null without a limit. */
export function timeLeftLabel(expiresAt: number | undefined, now: number): string | null {
  if (expiresAt === undefined) return null
  const ms = Math.max(0, expiresAt - now)
  return ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`
}

/** The run is close to its time limit and can still be extended. */
export function canExtendSoon(
  run: { state: string; expiresAt?: number; extensions?: number },
  maxExtensions: number,
  now: number
): boolean {
  return (
    run.state === 'running' &&
    run.expiresAt !== undefined &&
    run.expiresAt - now <= RUN_EXPIRY_WARN_MS &&
    (run.extensions ?? 0) < maxExtensions
  )
}

/**
 * What Run offers when the user already runs other apps (ADR-0057): side by side only with sandboxes and
 * under the per-user quota; otherwise stop one first.
 */
export function runChoices(
  others: number,
  limits: { sandbox: boolean; perUser: number }
): { ask: boolean; parallel: boolean } {
  if (others === 0) return { ask: false, parallel: true }
  return { ask: true, parallel: limits.sandbox && others < limits.perUser }
}
