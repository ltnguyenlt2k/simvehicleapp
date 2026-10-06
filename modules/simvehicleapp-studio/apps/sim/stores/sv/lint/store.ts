import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvDiagnostic } from '@/lib/api/contracts/sv'

/** Per-block summary for the canvas badge (stable object per block, so selectors do not re-render needlessly). */
export interface SvBlockProblems {
  errors: number
  warnings: number
  infos: number
  /** First message, by severity, for the badge tooltip. */
  first: string
}

export type SvLintStatus = 'idle' | 'checking' | 'ok' | 'unavailable'
export type SvVerifyStatus = 'idle' | 'verifying' | 'done' | 'unavailable'

interface SvLintState {
  workflowId: string | null
  /** What the Problems tab and badges show: the verify result while the graph is unchanged, else lint. */
  diagnostics: SvDiagnostic[]
  byBlock: Record<string, SvBlockProblems>
  status: SvLintStatus
  /** WorkflowGraph JSON currently on the canvas (what Verify sends) and adapter issues. */
  graphJson: string | null
  issues: SvDiagnostic[]
  lintDiagnostics: SvDiagnostic[]
  /** Last verify (M04-T11), valid only for the graph it was computed on. */
  verified: { graphJson: string; diagnostics: SvDiagnostic[] } | null
  verifyStatus: SvVerifyStatus
  /** True when `diagnostics` comes from a verify of the current graph. */
  verifiedFresh: boolean
  /** Bumped to bring the Problems tab to the front. */
  focusProblems: number
  setResult: (workflowId: string, diagnostics: SvDiagnostic[]) => void
  setStatus: (status: SvLintStatus) => void
  setGraph: (workflowId: string, graphJson: string, issues: SvDiagnostic[]) => void
  setVerified: (graphJson: string, diagnostics: SvDiagnostic[]) => void
  setVerifyStatus: (status: SvVerifyStatus) => void
  showProblems: () => void
  reset: () => void
}

const RANK = { error: 0, warning: 1, info: 2 } as const

export function summarizeByBlock(
  diagnostics: readonly SvDiagnostic[]
): Record<string, SvBlockProblems> {
  const out: Record<string, SvBlockProblems> = {}
  for (const d of [...diagnostics].sort((a, b) => RANK[a.severity] - RANK[b.severity])) {
    if (!d.blockId) continue
    const s = (out[d.blockId] ??= { errors: 0, warnings: 0, infos: 0, first: d.message })
    if (d.severity === 'error') s.errors++
    else if (d.severity === 'warning') s.warnings++
    else s.infos++
  }
  return out
}

type Derivable = Pick<SvLintState, 'graphJson' | 'issues' | 'lintDiagnostics' | 'verified'>

/** Verify of the current graph wins (it is a superset of lint); a stale verify is ignored. */
export function shownDiagnostics(s: Derivable): {
  diagnostics: SvDiagnostic[]
  verifiedFresh: boolean
} {
  if (s.verified && s.graphJson !== null && s.verified.graphJson === s.graphJson) {
    return { diagnostics: [...s.issues, ...s.verified.diagnostics], verifiedFresh: true }
  }
  return { diagnostics: s.lintDiagnostics, verifiedFresh: false }
}

function derive(s: Derivable) {
  const shown = shownDiagnostics(s)
  return { ...shown, byBlock: summarizeByBlock(shown.diagnostics) }
}

const initialState = {
  workflowId: null as string | null,
  diagnostics: [] as SvDiagnostic[],
  byBlock: {} as Record<string, SvBlockProblems>,
  status: 'idle' as SvLintStatus,
  graphJson: null as string | null,
  issues: [] as SvDiagnostic[],
  lintDiagnostics: [] as SvDiagnostic[],
  verified: null as SvLintState['verified'],
  verifyStatus: 'idle' as SvVerifyStatus,
  verifiedFresh: false,
  focusProblems: 0,
}

/** Lint and verify results of the open workflow (M03-T11, M04-T11): Problems tab + block badges. */
export const useSvLintStore = create<SvLintState>()(
  devtools(
    (set) => ({
      ...initialState,
      setResult: (workflowId, diagnostics) =>
        set((s) => {
          // a verify of another workflow never applies
          const verified = s.workflowId === workflowId ? s.verified : null
          const next = { ...s, lintDiagnostics: diagnostics, verified }
          return {
            workflowId,
            lintDiagnostics: diagnostics,
            verified,
            status: 'ok' as const,
            ...derive(next),
          }
        }),
      setStatus: (status) => set({ status }),
      setGraph: (workflowId, graphJson, issues) =>
        set((s) => {
          const verified = s.workflowId === workflowId ? s.verified : null
          const next = { ...s, graphJson, issues, verified }
          return { workflowId, graphJson, issues, verified, ...derive(next) }
        }),
      setVerified: (graphJson, diagnostics) =>
        set((s) => {
          const next = { ...s, verified: { graphJson, diagnostics } }
          return { verified: next.verified, verifyStatus: 'done' as const, ...derive(next) }
        }),
      setVerifyStatus: (verifyStatus) => set({ verifyStatus }),
      showProblems: () => set((s) => ({ focusProblems: s.focusProblems + 1 })),
      reset: () => set(initialState),
    }),
    { name: 'sv-lint-store' }
  )
)
