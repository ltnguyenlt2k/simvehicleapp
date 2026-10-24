import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvCreateDeployTargetBody,
  type SvDeployMode,
  svCreateDeployTargetContract,
  svDeleteDeployTargetContract,
  svListDeployTargetsContract,
  svStartDeploymentContract,
  svTestDeployTargetContract,
} from '@/lib/api/contracts/sv'
import { svRunKeys } from '@/hooks/queries/sv-runs'

/** Deploy targets of a workspace and deployments (ADR-0060, M18-T09). */
export const svDeployKeys = {
  all: ['sv-deploy'] as const,
  targets: () => [...svDeployKeys.all, 'targets'] as const,
  targetList: (workspaceId?: string) => [...svDeployKeys.targets(), workspaceId ?? ''] as const,
}

export function useSvDeployTargets(workspaceId?: string) {
  return useQuery({
    queryKey: svDeployKeys.targetList(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await requestJson(svListDeployTargetsContract, {
          query: { workspaceId: workspaceId as string },
          signal,
        })
      ).targets,
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCreateSvDeployTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SvCreateDeployTargetBody) =>
      requestJson(svCreateDeployTargetContract, { body }),
    onSettled: (_d, _e, body) =>
      queryClient.invalidateQueries({ queryKey: svDeployKeys.targetList(body.workspaceId) }),
  })
}

export function useDeleteSvDeployTarget() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, workspaceId }: { id: string; workspaceId: string }) =>
      requestJson(svDeleteDeployTargetContract, { params: { id }, query: { workspaceId } }),
    onSettled: (_d, _e, v) =>
      queryClient.invalidateQueries({ queryKey: svDeployKeys.targetList(v.workspaceId) }),
  })
}

export function useTestSvDeployTarget() {
  return useMutation({
    mutationFn: ({
      id,
      workspaceId,
      paths,
    }: {
      id: string
      workspaceId: string
      paths?: string[]
    }) =>
      requestJson(svTestDeployTargetContract, {
        params: { id },
        body: { workspaceId, ...(paths ? { paths } : {}) },
      }),
  })
}

export function useStartSvDeployment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      projectId,
      targetId,
      mode,
    }: {
      projectId: string
      targetId: string
      mode: SvDeployMode
    }) =>
      requestJson(svStartDeploymentContract, {
        params: { id: projectId },
        body: { targetId, mode },
      }),
    onSettled: (_d, _e, v) => {
      queryClient.invalidateQueries({ queryKey: svRunKeys.list(v.projectId) })
      queryClient.invalidateQueries({ queryKey: svRunKeys.mine() })
    },
  })
}
