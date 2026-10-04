/**
 * Sim subflow containers ↔ SimVehicleApp container BlockSpecs (M03-T10). The canvas keeps Sim's
 * `loop`/`parallel` container UI; the graph adapter (M4) turns them into `sv_repeat`, `sv_while`
 * and `sv_parallel` with this mapping. Modes without an SV meaning are rejected, not guessed.
 */

/** Sim container settings as stored on the workflow (`packages/workflow-types` Loop/Parallel). */
export interface SimContainer {
  type: 'loop' | 'parallel'
  loopType?: 'for' | 'forEach' | 'while' | 'doWhile'
  iterations?: number
  whileCondition?: string
  parallelType?: 'count' | 'collection'
  count?: number
}

export type SvContainerSpec =
  | { type: 'sv_repeat'; props: { count: number; intervalMs: number } }
  | { type: 'sv_while'; props: { condition: string; maxIterations: number; intervalMs: number } }
  | { type: 'sv_parallel'; props: { join: 'all' } }

/** Diagnostic for unsupported modes (public catalog code, ADR-0016). */
export interface SvContainerError {
  code: 'CONTAINER_INVALID'
  reason: 'unsupported_mode' | 'missing_condition' | 'bad_count'
  message: string
}

/** BlockSpec limits: `sv_repeat.count` 1…10 000, `sv_while.maxIterations` 1…1 000 000 (default 1 000). */
export const SV_REPEAT_MAX = 10_000
export const SV_WHILE_DEFAULT_MAX_ITERATIONS = 1_000
export const SV_WHILE_MAX_ITERATIONS = 1_000_000

/** Loop/parallel modes the studio offers (others are hidden in the container editor). */
export const SV_SUPPORTED_CONTAINER_MODES = {
  loop: ['for', 'while'],
  parallel: ['count'],
} as const

const invalid = (reason: SvContainerError['reason'], message: string): SvContainerError => ({
  code: 'CONTAINER_INVALID',
  reason,
  message,
})

export function mapSimContainer(c: SimContainer): SvContainerSpec | SvContainerError {
  if (c.type === 'parallel') {
    if ((c.parallelType ?? 'count') !== 'count') {
      return invalid('unsupported_mode', 'Parallel "each item" is not available for vehicle apps')
    }
    // Sim's parallel waits for every branch; `any`/`none` joins need an SV container setting (later).
    return { type: 'sv_parallel', props: { join: 'all' } }
  }
  const loopType = c.loopType ?? 'for'
  if (loopType === 'for') {
    const count = c.iterations ?? 0
    if (!Number.isInteger(count) || count < 1 || count > SV_REPEAT_MAX) {
      return invalid('bad_count', `Repeat count must be 1…${SV_REPEAT_MAX}`)
    }
    return { type: 'sv_repeat', props: { count, intervalMs: 0 } }
  }
  if (loopType === 'while') {
    const condition = c.whileCondition?.trim() ?? ''
    if (!condition) return invalid('missing_condition', 'While loop needs a condition')
    const raw = c.iterations
    const maxIterations =
      raw !== undefined && Number.isInteger(raw) && raw >= 1
        ? Math.min(raw, SV_WHILE_MAX_ITERATIONS)
        : SV_WHILE_DEFAULT_MAX_ITERATIONS
    return { type: 'sv_while', props: { condition, maxIterations, intervalMs: 0 } }
  }
  return invalid('unsupported_mode', `Loop type "${loopType}" is not available for vehicle apps`)
}
