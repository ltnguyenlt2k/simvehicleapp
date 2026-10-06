import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvLogLine } from '@/lib/api/contracts/sv'

/** Lines kept in the Build log; older ones drop (the orchestrator keeps the full log). */
export const SV_BUILD_LOG_LIMIT = 5000

interface SvSynCodeState {
  /** The generation the Build log follows. */
  projectId: string | null
  generationId: string | null
  /** Project chosen for SynCode when the workflow belongs to several. */
  selectedProjectId: string | null
  lines: SvLogLine[]
  /** Bumped to bring the Build log tab to the front. */
  focusBuildLog: number
  selectProject: (projectId: string) => void
  start: (projectId: string, generationId: string) => void
  /** Adds stream lines in order, ignoring ones already seen (a reconnect replays after Last-Event-ID). */
  append: (generationId: string, lines: SvLogLine[]) => void
  showBuildLog: () => void
  clear: () => void
}

const initialState = {
  projectId: null as string | null,
  generationId: null as string | null,
  selectedProjectId: null as string | null,
  lines: [] as SvLogLine[],
  focusBuildLog: 0,
}

/** SynCode of the open workflow: the generation followed and its build log (M07-T18). */
export const useSvSynCodeStore = create<SvSynCodeState>()(
  devtools(
    (set) => ({
      ...initialState,
      selectProject: (selectedProjectId) => set({ selectedProjectId }),
      start: (projectId, generationId) =>
        set((s) => ({ projectId, generationId, lines: [], focusBuildLog: s.focusBuildLog + 1 })),
      append: (generationId, incoming) =>
        set((s) => {
          if (s.generationId !== generationId) return s
          const last = s.lines.length ? s.lines[s.lines.length - 1].seq : -1
          const fresh = incoming.filter((l) => l.seq > last)
          if (!fresh.length) return s
          const lines = s.lines.concat(fresh)
          return {
            lines: lines.length > SV_BUILD_LOG_LIMIT ? lines.slice(-SV_BUILD_LOG_LIMIT) : lines,
          }
        }),
      showBuildLog: () => set((s) => ({ focusBuildLog: s.focusBuildLog + 1 })),
      clear: () => set(initialState),
    }),
    { name: 'sv-syncode-store' }
  )
)
