/**
 * Editor surfaces of Sim that run a workflow on Sim's own executor (ADR-0056, M17-T02). A vehicle workflow runs
 * only through the simulator (Simulate) and the generated Velocitas app (Run); Sim's executor would hand every
 * `sv_*` block to its generic handler and produce results that disagree with the IR. One list, used by the editor
 * and the proxy; the Sim files stay in the tree (ADR-0008) and are removed in a later cleanup.
 */
const HIDDEN_SURFACES = ['workflow-chat', 'run-from-block', 'run-until-block'] as const

export type SvHiddenSurface = (typeof HIDDEN_SURFACES)[number]

export function isHiddenSurface(surface: SvHiddenSurface): boolean {
  return (HIDDEN_SURFACES as readonly string[]).includes(surface)
}

/** API routes behind those surfaces: Sim's workflow chat and executor. */
const HIDDEN_API = [
  /^\/api\/workflows\/[^/]+\/execute(?:\/.*)?$/,
  /^\/api\/workflows\/[^/]+\/chat(?:\/.*)?$/,
] as const

/** True when the API path only serves a hidden surface: the proxy answers 404. */
export function isHiddenApiRoute(pathname: string): boolean {
  return HIDDEN_API.some((r) => r.test(pathname))
}
