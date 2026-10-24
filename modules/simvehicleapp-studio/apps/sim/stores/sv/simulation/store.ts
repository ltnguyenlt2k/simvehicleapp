import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvScenario, SvSimulateResponse } from '@/lib/api/contracts/sv'

type SimResult = NonNullable<SvSimulateResponse['result']>

interface SvSimulationState {
  workflowId: string | null
  /** Graph the result was simulated on; the replay overlay shows only while it is still the canvas graph. */
  graphJson: string | null
  until: number
  result: SimResult | null
  /** The scenario `result` was simulated with (its expectations explain a failure, M19-T06). */
  scenario: SvScenario | null
  /** Replay cursor (virtual ms). */
  cursor: number
  status: 'idle' | 'running' | 'done' | 'failed'
  /** Scenario being edited (saved after a short debounce); Simulate always uses what the editor shows. */
  draft: { workflowId: string; scenario: SvScenario; caseId?: string } | null
  /** `caseId`: the test case the draft belongs to (ADR-0058); Simulate saves it there. */
  setDraft: (workflowId: string, scenario: SvScenario, caseId?: string) => void
  /** Bumped to bring the Simulation tab to the front. */
  focusSimulation: number
  showSimulation: () => void
  setRunning: () => void
  setResult: (
    workflowId: string,
    graphJson: string,
    until: number,
    result: SimResult,
    scenario?: SvScenario
  ) => void
  setFailed: () => void
  setCursor: (cursor: number) => void
  clear: () => void
}

const initialState = {
  workflowId: null as string | null,
  graphJson: null as string | null,
  until: 0,
  result: null as SimResult | null,
  scenario: null as SvScenario | null,
  cursor: 0,
  status: 'idle' as SvSimulationState['status'],
  focusSimulation: 0,
  draft: null as SvSimulationState['draft'],
}

/** Last simulation of the open workflow and the replay cursor (M05-T10). */
export const useSvSimulationStore = create<SvSimulationState>()(
  devtools(
    (set) => ({
      ...initialState,
      setRunning: () => set({ status: 'running' }),
      setDraft: (workflowId, scenario, caseId) =>
        set({ draft: { workflowId, scenario, ...(caseId ? { caseId } : {}) } }),
      showSimulation: () => set((s) => ({ focusSimulation: s.focusSimulation + 1 })),
      setResult: (workflowId, graphJson, until, result, scenario) =>
        set({
          workflowId,
          graphJson,
          until,
          result,
          scenario: scenario ?? null,
          cursor: until,
          status: 'done',
        }),
      setFailed: () => set({ status: 'failed' }),
      setCursor: (cursor) => set((s) => ({ cursor: Math.max(0, Math.min(s.until, cursor)) })),
      clear: () => set(initialState),
    }),
    { name: 'sv-simulation-store' }
  )
)
