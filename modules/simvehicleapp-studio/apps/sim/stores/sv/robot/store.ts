import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SvRobotMode } from '@/lib/api/contracts/sv-robotics'

interface SvRobotState {
  /** Robot target of the actions: lightweight mock or the ROS 2 dog simulation (ADR-0068). */
  mode: SvRobotMode
  buildId: string | null
  deploymentId: string | null
  runId: string | null
  /** Block the running app is executing (from its trace), highlighted on the canvas. */
  activeNodeId: string | null
  /** Bumped to bring a dock tab forward (Start → Live, Check → Problems), like the vehicle dock. */
  focus: { tab: 'problems' | 'live'; n: number }
  setMode: (mode: SvRobotMode) => void
  setBuild: (buildId: string | null) => void
  setDeployment: (deploymentId: string | null) => void
  setRun: (runId: string | null) => void
  setActiveNode: (nodeId: string | null) => void
  showTab: (tab: 'problems' | 'live') => void
  reset: () => void
}

const initialState = {
  mode: 'ros-sim' as SvRobotMode,
  buildId: null,
  deploymentId: null,
  runId: null,
  activeNodeId: null,
  focus: { tab: 'problems' as const, n: 0 },
}

/** Robot workflow actions of the open workflow (build → deploy → run). */
export const useSvRobotStore = create<SvRobotState>()(
  devtools(
    (set) => ({
      ...initialState,
      setMode: (mode) => set({ mode, deploymentId: null }),
      setBuild: (buildId) => set({ buildId, deploymentId: null }),
      setDeployment: (deploymentId) => set({ deploymentId }),
      setRun: (runId) => set({ runId }),
      setActiveNode: (activeNodeId) => set({ activeNodeId }),
      showTab: (tab) => set((s) => ({ focus: { tab, n: s.focus.n + 1 } })),
      reset: () => set(initialState),
    }),
    { name: 'sv-robot-store' }
  )
)
