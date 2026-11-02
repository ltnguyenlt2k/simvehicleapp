import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvUpdateWorkflowSettingsBody,
  type SvWorkflowSettings,
  svGetWorkflowSettingsContract,
  svUpdateWorkflowSettingsContract,
} from '@/lib/api/contracts/sv'

export const svWorkflowSettingsKeys = {
  all: ['sv-workflow-settings'] as const,
  details: () => [...svWorkflowSettingsKeys.all, 'detail'] as const,
  detail: (workflowId?: string) => [...svWorkflowSettingsKeys.details(), workflowId ?? ''] as const,
}

async function fetchSvWorkflowSettings(
  workflowId: string,
  signal?: AbortSignal
): Promise<SvWorkflowSettings> {
  return requestJson(svGetWorkflowSettingsContract, { params: { id: workflowId }, signal })
}

/** SimVehicleApp settings of a workflow (VSS release, M02-T11). */
export function useSvWorkflowSettings(workflowId?: string) {
  return useQuery({
    queryKey: svWorkflowSettingsKeys.detail(workflowId),
    queryFn: ({ signal }) => fetchSvWorkflowSettings(workflowId as string, signal),
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000,
  })
}

type UpdateSvWorkflowSettingsVariables = SvUpdateWorkflowSettingsBody & { workflowId: string }

/** Pins a workflow to a VSS release or the robot domain; the signal tree and the palette follow. */
export function useUpdateSvWorkflowSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workflowId, ...body }: UpdateSvWorkflowSettingsVariables) =>
      requestJson(svUpdateWorkflowSettingsContract, { params: { id: workflowId }, body }),
    onSuccess: (data, { workflowId }) => {
      queryClient.setQueryData(svWorkflowSettingsKeys.detail(workflowId), data)
    },
    onSettled: (_data, _error, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: svWorkflowSettingsKeys.detail(workflowId) })
    },
  })
}
