import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvRobotCatalog,
  type SvRobotConfig,
  type SvRobotFlow,
  type SvRobotMode,
  type SvRobotRun,
  svRobotBuildContract,
  svRobotCatalogContract,
  svRobotConfigContract,
  svRobotDeployContract,
  svRobotLintContract,
  svRobotRunContract,
  svRobotStartContract,
  svRobotStopContract,
} from '@/lib/api/contracts/sv-robotics'

export const svRobotKeys = {
  all: ['sv-robotics'] as const,
  configs: () => [...svRobotKeys.all, 'config'] as const,
  catalogs: () => [...svRobotKeys.all, 'catalog'] as const,
  lints: () => [...svRobotKeys.all, 'lint'] as const,
  lint: (workflowId?: string, mode?: SvRobotMode, flowJson?: string) =>
    [...svRobotKeys.lints(), workflowId ?? '', mode ?? 'mock', flowJson ?? ''] as const,
  runs: () => [...svRobotKeys.all, 'run'] as const,
  run: (runId?: string) => [...svRobotKeys.runs(), runId ?? ''] as const,
}

async function fetchConfig(signal?: AbortSignal): Promise<SvRobotConfig> {
  return requestJson(svRobotConfigContract, { signal })
}

async function fetchRun(runId: string, signal?: AbortSignal): Promise<SvRobotRun> {
  return requestJson(svRobotRunContract, { params: { id: runId }, query: { after: 0 }, signal })
}

async function fetchCatalog(signal?: AbortSignal): Promise<SvRobotCatalog> {
  return requestJson(svRobotCatalogContract, { signal })
}

/**
 * RSS catalog of the robot profile: the signal tree of a robot workflow (changes only with the profile). Asked once:
 * a studio without the robotics stack answers 503 and is not asked again on every mount (no retry storm).
 */
export function useSvRobotCatalog(enabled: boolean) {
  return useQuery({
    queryKey: svRobotKeys.catalogs(),
    queryFn: ({ signal }) => fetchCatalog(signal),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
  })
}

/** Robot Zoo link and the robot observed on each mode; refreshed while the editor is open. */
export function useSvRobotConfig(enabled: boolean) {
  return useQuery({
    queryKey: svRobotKeys.configs(),
    queryFn: ({ signal }) => fetchConfig(signal),
    enabled,
    staleTime: 2000,
    refetchInterval: enabled ? 3000 : false,
  })
}

/** RobotFlow checks of the canvas (debounced upstream). */
export function useSvRobotLint(
  workflowId: string | undefined,
  mode: SvRobotMode,
  flowJson: string | undefined
) {
  return useQuery({
    queryKey: svRobotKeys.lint(workflowId, mode, flowJson),
    queryFn: ({ signal }) =>
      requestJson(svRobotLintContract, {
        body: {
          workflowId: workflowId as string,
          mode,
          workflow: JSON.parse(flowJson as string) as SvRobotFlow,
        },
        signal,
      }),
    enabled: Boolean(workflowId && flowJson),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

/** Status and trace of a run; polled every 400 ms while it runs. */
export function useSvRobotRun(runId: string | undefined) {
  return useQuery({
    queryKey: svRobotKeys.run(runId),
    queryFn: ({ signal }) => fetchRun(runId as string, signal),
    enabled: Boolean(runId),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.state === 'running' || !query.state.data ? 400 : false,
  })
}

export function useSvRobotBuild() {
  return useMutation({
    mutationFn: (body: { workflowId: string; mode: SvRobotMode; workflow: SvRobotFlow }) =>
      requestJson(svRobotBuildContract, { body }),
  })
}

export function useSvRobotDeploy() {
  return useMutation({
    mutationFn: (body: { workflowId: string; buildId: string; mode: SvRobotMode }) =>
      requestJson(svRobotDeployContract, { body }),
  })
}

export function useSvRobotStart() {
  return useMutation({
    mutationFn: (body: { workflowId: string; deploymentId: string }) =>
      requestJson(svRobotStartContract, { body }),
  })
}

export function useSvRobotStop() {
  return useMutation({
    mutationFn: (runId: string) => requestJson(svRobotStopContract, { params: { id: runId } }),
  })
}
