import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvScenario,
  svCreateTestCaseContract,
  svDeleteTestCaseContract,
  svListTestCasesContract,
  svUpdateTestCaseContract,
} from '@/lib/api/contracts/sv'
import { svScenarioKeys } from '@/hooks/queries/sv-simulation'

export const svTestCaseKeys = {
  all: ['sv-test-cases'] as const,
  lists: () => [...svTestCaseKeys.all, 'list'] as const,
  list: (workflowId?: string) => [...svTestCaseKeys.lists(), workflowId ?? ''] as const,
}

/** Test cases of the workflow in order (ADR-0058, M18-T04). */
export function useSvTestCases(workflowId: string | undefined) {
  return useQuery({
    queryKey: svTestCaseKeys.list(workflowId),
    queryFn: async ({ signal }) =>
      (await requestJson(svListTestCasesContract, { params: { id: workflowId as string }, signal }))
        .cases,
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000,
  })
}

/** The first case is also the workflow's scenario (`/scenario`): both caches follow a change. */
function useInvalidate(workflowId: string | undefined) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: svTestCaseKeys.list(workflowId) })
    queryClient.invalidateQueries({ queryKey: svScenarioKeys.detail(workflowId) })
  }
}

export function useCreateSvTestCase(workflowId: string | undefined) {
  const invalidate = useInvalidate(workflowId)
  return useMutation({
    mutationFn: (body: { name: string; scenario: SvScenario }) =>
      requestJson(svCreateTestCaseContract, { params: { id: workflowId as string }, body }),
    onSettled: invalidate,
  })
}

interface UpdateTestCaseVariables {
  caseId: string
  name?: string
  scenario?: SvScenario
  position?: number
}

export function useUpdateSvTestCase(workflowId: string | undefined) {
  const invalidate = useInvalidate(workflowId)
  return useMutation({
    mutationFn: ({ caseId, ...body }: UpdateTestCaseVariables) =>
      requestJson(svUpdateTestCaseContract, {
        params: { id: workflowId as string, caseId },
        body,
      }),
    onSettled: invalidate,
  })
}

export function useDeleteSvTestCase(workflowId: string | undefined) {
  const invalidate = useInvalidate(workflowId)
  return useMutation({
    mutationFn: (caseId: string) =>
      requestJson(svDeleteTestCaseContract, { params: { id: workflowId as string, caseId } }),
    onSettled: invalidate,
  })
}
