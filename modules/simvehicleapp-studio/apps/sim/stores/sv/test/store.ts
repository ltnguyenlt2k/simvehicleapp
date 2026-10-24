import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

/** Outcome of one case's last Simulate (ADR-0058 §4). */
export interface SvCaseOutcome {
  passed: boolean
  mismatches: string[]
  /** Graph the case ran on: the outcome is stale once the canvas changes. */
  graphJson: string
  /** Blocks the case entered (branch coverage). */
  blockIds: string[]
}

interface SvTestState {
  workflowId: string | null
  /** Case the editor shows and Simulate runs. */
  activeCaseId: string | null
  outcomes: Record<string, SvCaseOutcome>
  open: (workflowId: string) => void
  setActiveCase: (caseId: string | null) => void
  setOutcome: (caseId: string, outcome: SvCaseOutcome) => void
  forget: (caseId: string) => void
  reset: () => void
}

const initialState = {
  workflowId: null as string | null,
  activeCaseId: null as string | null,
  outcomes: {} as Record<string, SvCaseOutcome>,
}

/** Test tab of the open workflow (M18-T04): the active case and every case's last outcome. */
export const useSvTestStore = create<SvTestState>()(
  devtools(
    (set) => ({
      ...initialState,
      open: (workflowId) =>
        set((s) => (s.workflowId === workflowId ? s : { ...initialState, workflowId })),
      setActiveCase: (activeCaseId) => set({ activeCaseId }),
      setOutcome: (caseId, outcome) =>
        set((s) => ({ outcomes: { ...s.outcomes, [caseId]: outcome } })),
      forget: (caseId) =>
        set((s) => {
          const { [caseId]: _gone, ...outcomes } = s.outcomes
          return { outcomes, activeCaseId: s.activeCaseId === caseId ? null : s.activeCaseId }
        }),
      reset: () => set(initialState),
    }),
    { name: 'sv-test-store' }
  )
)
