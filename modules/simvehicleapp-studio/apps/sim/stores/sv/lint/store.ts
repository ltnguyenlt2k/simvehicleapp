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

interface SvLintState {
  workflowId: string | null
  diagnostics: SvDiagnostic[]
  byBlock: Record<string, SvBlockProblems>
  status: SvLintStatus
  setResult: (workflowId: string, diagnostics: SvDiagnostic[]) => void
  setStatus: (status: SvLintStatus) => void
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

const initialState = {
  workflowId: null as string | null,
  diagnostics: [] as SvDiagnostic[],
  byBlock: {} as Record<string, SvBlockProblems>,
  status: 'idle' as SvLintStatus,
}

/** Latest lint result of the open workflow (M03-T11): Problems tab + block badges. */
export const useSvLintStore = create<SvLintState>()(
  devtools(
    (set) => ({
      ...initialState,
      setResult: (workflowId, diagnostics) =>
        set({ workflowId, diagnostics, byBlock: summarizeByBlock(diagnostics), status: 'ok' }),
      setStatus: (status) => set({ status }),
      reset: () => set(initialState),
    }),
    { name: 'sv-lint-store' }
  )
)
