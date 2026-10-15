import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface SvCanvasHighlightState {
  /** Normalized name of the block a "uses:" chip points at while the pointer is on it (ADR-0055). */
  blockName: string | null
  highlight: (blockName: string | null) => void
}

/** The block a data chip refers to, highlighted on the canvas (M16-T09). */
export const useSvCanvasHighlightStore = create<SvCanvasHighlightState>()(
  devtools(
    (set) => ({
      blockName: null,
      highlight: (blockName) => set({ blockName }),
    }),
    { name: 'sv-canvas-highlight-store' }
  )
)
