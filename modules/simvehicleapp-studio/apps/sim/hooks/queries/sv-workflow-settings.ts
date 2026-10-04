import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
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

interface UpdateSvWorkflowSettingsVariables {
  workflowId: string
  vssRelease: string
}

/** Pins a workflow to a VSS release; the catalog tree/search re-key on the new release. */
export function useUpdateSvWorkflowSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ workflowId, vssRelease }: UpdateSvWorkflowSettingsVariables) =>
      requestJson(svUpdateWorkflowSettingsContract, {
        params: { id: workflowId },
        body: { vssRelease },
      }),
    onSuccess: (data, { workflowId }) => {
      queryClient.setQueryData(svWorkflowSettingsKeys.detail(workflowId), data)
    },
    onSettled: (_data, _error, { workflowId }) => {
      queryClient.invalidateQueries({ queryKey: svWorkflowSettingsKeys.detail(workflowId) })
    },
  })
}
