import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvScenario,
  type SvSimulateResponse,
  svGetScenarioContract,
  svSimulateContract,
  svUpdateScenarioContract,
} from '@/lib/api/contracts/sv'

export const svScenarioKeys = {
  all: ['sv-scenario'] as const,
  details: () => [...svScenarioKeys.all, 'detail'] as const,
  detail: (workflowId?: string) => [...svScenarioKeys.details(), workflowId ?? ''] as const,
}

/** Saved simulation scenario of the workflow (`null` when none yet, M05-T09). */
export function useSvScenario(workflowId: string | undefined) {
  return useQuery({
    queryKey: svScenarioKeys.detail(workflowId),
    queryFn: async ({ signal }) =>
      (await requestJson(svGetScenarioContract, { params: { id: workflowId as string }, signal }))
        .scenario,
    enabled: Boolean(workflowId),
    staleTime: 60 * 1000,
  })
}

export function useSaveSvScenario(workflowId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (scenario: SvScenario) =>
      (
        await requestJson(svUpdateScenarioContract, {
          params: { id: workflowId as string },
          body: { scenario },
        })
      ).scenario,
    onMutate: async (scenario) => {
      await queryClient.cancelQueries({ queryKey: svScenarioKeys.detail(workflowId) })
      const previous = queryClient.getQueryData(svScenarioKeys.detail(workflowId))
      queryClient.setQueryData(svScenarioKeys.detail(workflowId), scenario)
      return { previous }
    },
    onError: (_error, _scenario, context) => {
      queryClient.setQueryData(svScenarioKeys.detail(workflowId), context?.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: svScenarioKeys.detail(workflowId) }),
  })
}

/** Compile + simulate the graph on the canvas with a scenario (M05-T10). */
export function useSvSimulate() {
  return useMutation({
    mutationFn: async (input: {
      graphJson: string
      scenario: SvScenario
    }): Promise<SvSimulateResponse> =>
      requestJson(svSimulateContract, {
        body: {
          graph: JSON.parse(input.graphJson) as Record<string, unknown>,
          scenario: input.scenario,
        },
      }),
  })
}
