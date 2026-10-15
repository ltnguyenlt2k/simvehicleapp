import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvLogLine } from '@/lib/api/contracts/sv'

/** Lines kept in the Build log; older ones drop (the orchestrator keeps the full log). */
export const SV_BUILD_LOG_LIMIT = 5000

interface SvSynCodeState {
  /** The generation the Build log follows. */
  projectId: string | null
  generationId: string | null
  /** Graph of the open workflow that generation was made from: the build is fresh while the canvas still shows it. */
  sentGraphJson: string | null
  /** Project chosen for SynCode when the workflow belongs to several. */
  selectedProjectId: string | null
  /** App created (or joined) from the SynCode dialog: SynCode starts by itself once it is ready (ADR-0053 §A). */
  autoSynCodeProjectId: string | null
  /** The "Create a vehicle app" dialog is open (SynCode without an app, or the app chip). */
  createAppOpen: boolean
  lines: SvLogLine[]
  /** Bumped to bring the Build log tab to the front. */
  focusBuildLog: number
  selectProject: (projectId: string) => void
  /** Selects the app and asks for a SynCode as soon as it is ready. */
  requestAutoSynCode: (projectId: string) => void
  clearAutoSynCode: () => void
  setCreateAppOpen: (open: boolean) => void
  start: (projectId: string, generationId: string, sentGraphJson?: string) => void
  /** Adds stream lines in order, ignoring ones already seen (a reconnect replays after Last-Event-ID). */
  append: (generationId: string, lines: SvLogLine[]) => void
  showBuildLog: () => void
  clear: () => void
}

const initialState = {
  projectId: null as string | null,
  generationId: null as string | null,
  sentGraphJson: null as string | null,
  selectedProjectId: null as string | null,
  autoSynCodeProjectId: null as string | null,
  createAppOpen: false,
  lines: [] as SvLogLine[],
  focusBuildLog: 0,
}

/** SynCode of the open workflow: the generation followed and its build log (M07-T18). */
export const useSvSynCodeStore = create<SvSynCodeState>()(
  devtools(
    (set) => ({
      ...initialState,
      selectProject: (selectedProjectId) => set({ selectedProjectId }),
      requestAutoSynCode: (projectId) =>
        set({ selectedProjectId: projectId, autoSynCodeProjectId: projectId }),
      clearAutoSynCode: () => set({ autoSynCodeProjectId: null }),
      setCreateAppOpen: (createAppOpen) => set({ createAppOpen }),
      start: (projectId, generationId, sentGraphJson) =>
        set((s) => ({
          projectId,
          generationId,
          sentGraphJson: sentGraphJson ?? null,
          lines: [],
          focusBuildLog: s.focusBuildLog + 1,
        })),
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
