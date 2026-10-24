import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface SvCanvasViewState {
  /** Every vehicle block shows its settings, not only the selected one (ADR-0059 §1); kept per browser. */
  details: boolean
  /** The Logic view is open over the canvas (ADR-0059 §2). */
  logicOpen: boolean
  setDetails: (details: boolean) => void
  setLogicOpen: (open: boolean) => void
  reset: () => void
}

const initialState = { details: false, logicOpen: false }

/** How the vehicle canvas reads (M18-T07): compact blocks with a Details toggle, and the Logic view. */
export const useSvCanvasViewStore = create<SvCanvasViewState>()(
  devtools(
    persist(
      (set) => ({
        ...initialState,
        setDetails: (details) => set({ details }),
        setLogicOpen: (logicOpen) => set({ logicOpen }),
        reset: () => set(initialState),
      }),
      { name: 'sv-canvas-view', partialize: (state) => ({ details: state.details }) }
    ),
    { name: 'sv-canvas-view-store' }
  )
)
