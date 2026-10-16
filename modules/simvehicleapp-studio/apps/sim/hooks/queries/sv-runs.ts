import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvRun,
  type SvScenario,
  type SvSignalField,
  svExtendRunContract,
  svListRunsContract,
  svMyRunsContract,
  svPlayScenarioContract,
  svSetSignalContract,
  svStartRunContract,
  svStopRunContract,
} from '@/lib/api/contracts/sv'

export const svRunKeys = {
  all: ['sv-runs'] as const,
  lists: () => [...svRunKeys.all, 'list'] as const,
  list: (projectId?: string) => [...svRunKeys.lists(), projectId ?? ''] as const,
  mine: () => [...svRunKeys.all, 'mine'] as const,
}

const ACTIVE: ReadonlySet<SvRun['state']> = new Set(['starting', 'running', 'stopping'])

/** The run of a project that is starting, running or stopping, if any. */
export const activeRunOf = (runs: SvRun[] | undefined) => runs?.find((r) => ACTIVE.has(r.state))

/** Recent runs of the project; polled while one is active so the state follows the app (M08-T08). */
export function useSvRuns(projectId?: string) {
  return useQuery({
    queryKey: svRunKeys.list(projectId),
    queryFn: async ({ signal }) =>
      (await requestJson(svListRunsContract, { params: { id: projectId as string }, signal })).runs,
    enabled: Boolean(projectId),
    staleTime: 5 * 1000,
    refetchInterval: (query) => (activeRunOf(query.state.data) ? 2000 : false),
  })
}

/** The apps the signed-in user runs now, in every workspace, and the run limits (My runs, ADR-0057). */
export function useMySvRuns() {
  return useQuery({
    queryKey: svRunKeys.mine(),
    queryFn: async ({ signal }) => requestJson(svMyRunsContract, { signal }),
    staleTime: 5 * 1000,
    refetchInterval: (query) => (query.state.data?.runs.length ? 5000 : 30_000),
  })
}

/** Run: the app of the project's latest SynCode on the runtime stack. */
export function useStartSvRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) =>
      requestJson(svStartRunContract, { params: { id: projectId }, body: {} }),
    onSettled: (_data, _error, projectId) => {
      queryClient.invalidateQueries({ queryKey: svRunKeys.list(projectId) })
      queryClient.invalidateQueries({ queryKey: svRunKeys.mine() })
    },
  })
}

interface StopSvRunVariables {
  projectId: string
  runId: string
}

export function useStopSvRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, runId }: StopSvRunVariables) =>
      requestJson(svStopRunContract, { params: { id: projectId, rid: runId } }),
    onSettled: (_data, _error, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: svRunKeys.list(projectId) })
      queryClient.invalidateQueries({ queryKey: svRunKeys.mine() })
    },
  })
}

/** Extend: the run's time limit moves by the stack's `SV_RUN_MAX_MINUTES` (ADR-0057). */
export function useExtendSvRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, runId }: StopSvRunVariables) =>
      requestJson(svExtendRunContract, { params: { id: projectId, rid: runId } }),
    onSettled: (_data, _error, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: svRunKeys.list(projectId) })
      queryClient.invalidateQueries({ queryKey: svRunKeys.mine() })
    },
  })
}

interface SetSvSignalVariables {
  projectId: string
  path: string
  value: SvScenario['inputs'][number]['value']
  field: SvSignalField
}

/** Inject a value on the project's databroker (through the signal-gateway). */
export function useSetSvSignal() {
  return useMutation({
    mutationFn: ({ projectId, path, value, field }: SetSvSignalVariables) =>
      requestJson(svSetSignalContract, { params: { id: projectId }, body: { path, value, field } }),
  })
}

interface PlaySvScenarioVariables {
  projectId: string
  scenario: SvScenario
}

/** Plays a scenario on the project's databroker (M08-T07). */
export function usePlaySvScenario() {
  return useMutation({
    mutationFn: ({ projectId, scenario }: PlaySvScenarioVariables) =>
      requestJson(svPlayScenarioContract, { params: { id: projectId }, body: { scenario } }),
  })
}
