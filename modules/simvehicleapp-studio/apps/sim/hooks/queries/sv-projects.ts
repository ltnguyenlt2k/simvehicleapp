import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvCreateProjectBody,
  type SvGeneration,
  type SvProject,
  type SvStartGenerationBody,
  svCapacityContract,
  svCleanProjectContract,
  svCreateProjectContract,
  svDeleteProjectContract,
  svGetGenerationContract,
  svGetProjectContract,
  svListProjectsContract,
  svProjectFileContract,
  svProjectFilesContract,
  svProjectSizeContract,
  svReconcileContract,
  svRepairProjectContract,
  svStartGenerationContract,
  svUpdateProjectWorkflowsContract,
} from '@/lib/api/contracts/sv'

export const svProjectKeys = {
  all: ['sv-projects'] as const,
  lists: () => [...svProjectKeys.all, 'list'] as const,
  list: (workspaceId?: string) => [...svProjectKeys.lists(), workspaceId ?? ''] as const,
  details: () => [...svProjectKeys.all, 'detail'] as const,
  detail: (id?: string) => [...svProjectKeys.details(), id ?? ''] as const,
  generations: () => [...svProjectKeys.all, 'generation'] as const,
  generation: (projectId?: string, generationId?: string) =>
    [...svProjectKeys.generations(), projectId ?? '', generationId ?? ''] as const,
  files: (projectId?: string) => [...svProjectKeys.all, 'files', projectId ?? ''] as const,
  sizes: () => [...svProjectKeys.all, 'size'] as const,
  size: (projectId?: string) => [...svProjectKeys.sizes(), projectId ?? ''] as const,
  capacity: (workspaceId?: string) =>
    [...svProjectKeys.all, 'capacity', workspaceId ?? ''] as const,
  file: (projectId?: string, path?: string, generationId?: string) =>
    [...svProjectKeys.all, 'file', projectId ?? '', path ?? '', generationId ?? ''] as const,
}

const preparing = (projects: SvProject[] | undefined) =>
  projects?.some((p) => p.status === 'creating') ?? false

/** Vehicle-app projects of the workspace; polls while one is still being prepared (M07-T17). */
export function useSvProjects(workspaceId?: string) {
  return useQuery({
    queryKey: svProjectKeys.list(workspaceId),
    queryFn: async ({ signal }) =>
      (
        await requestJson(svListProjectsContract, {
          query: { workspaceId: workspaceId as string },
          signal,
        })
      ).projects,
    enabled: Boolean(workspaceId),
    staleTime: 10 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (preparing(query.state.data) ? 2000 : false),
  })
}

export function useSvProject(projectId?: string) {
  return useQuery({
    queryKey: svProjectKeys.detail(projectId),
    queryFn: ({ signal }) =>
      requestJson(svGetProjectContract, { params: { id: projectId as string }, signal }),
    enabled: Boolean(projectId),
    staleTime: 10 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.status === 'creating' ? 2000 : false),
  })
}

export function useCreateSvProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SvCreateProjectBody) => requestJson(svCreateProjectContract, { body }),
    onSettled: (_data, _error, body) => {
      queryClient.invalidateQueries({ queryKey: svProjectKeys.list(body.workspaceId) })
      // The app counts against the workspace and host quotas shown above the list.
      queryClient.invalidateQueries({ queryKey: svProjectKeys.capacity(body.workspaceId) })
    },
  })
}

interface UpdateSvProjectWorkflowsVariables {
  projectId: string
  workflowIds: string[]
}

/** Replaces the workflows SynCode generates into the project. */
export function useUpdateSvProjectWorkflows() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, workflowIds }: UpdateSvProjectWorkflowsVariables) =>
      requestJson(svUpdateProjectWorkflowsContract, {
        params: { id: projectId },
        body: { workflowIds },
      }),
    onSuccess: (project) => queryClient.setQueryData(svProjectKeys.detail(project.id), project),
    onSettled: () => queryClient.invalidateQueries({ queryKey: svProjectKeys.lists() }),
  })
}

interface StartSvGenerationVariables {
  projectId: string
  body: SvStartGenerationBody
}

/** SynCode: queues a generation of every enabled workflow of the project (M07-T18). */
export function useStartSvGeneration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, body }: StartSvGenerationVariables) =>
      requestJson(svStartGenerationContract, { params: { id: projectId }, body }),
    onSuccess: (generation) =>
      queryClient.setQueryData(
        svProjectKeys.generation(generation.projectId, generation.id),
        generation
      ),
  })
}

const running = (g: SvGeneration | undefined) => g?.state === 'queued' || g?.state === 'running'

/** A generation; refreshed while it runs (the log itself streams over SSE). */
export function useSvGeneration(projectId?: string, generationId?: string) {
  return useQuery({
    queryKey: svProjectKeys.generation(projectId, generationId),
    queryFn: ({ signal }) =>
      requestJson(svGetGenerationContract, {
        params: { id: projectId as string, gid: generationId as string },
        signal,
      }),
    enabled: Boolean(projectId && generationId),
    staleTime: 5 * 1000,
    refetchInterval: (query) => (running(query.state.data) ? 1500 : false),
  })
}

/** Files of the project folder and its retained generations (M07-T19). */
export function useSvProjectFiles(projectId?: string) {
  return useQuery({
    queryKey: svProjectKeys.files(projectId),
    queryFn: ({ signal }) =>
      requestJson(svProjectFilesContract, { params: { id: projectId as string }, signal }),
    enabled: Boolean(projectId),
    staleTime: 10 * 1000,
    placeholderData: keepPreviousData,
  })
}

/** One file, current or as a retained generation wrote it (`null` when that generation lacks it). */
export function useSvProjectFile(projectId?: string, path?: string, generationId?: string) {
  return useQuery({
    queryKey: svProjectKeys.file(projectId, path, generationId),
    queryFn: async ({ signal }) => {
      try {
        return await requestJson(svProjectFileContract, {
          params: { id: projectId as string },
          query: { path: path as string, ...(generationId ? { generationId } : {}) },
          signal,
        })
      } catch (error) {
        if (generationId && error instanceof ApiClientError && error.status === 404) return null
        throw error
      }
    },
    enabled: Boolean(projectId && path),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

/** Disk usage of a vehicle app (ADR-0053); measured on demand, kept a minute. */
export function useSvProjectSize(projectId?: string, enabled = true) {
  return useQuery({
    queryKey: svProjectKeys.size(projectId),
    queryFn: ({ signal }) =>
      requestJson(svProjectSizeContract, { params: { id: projectId as string }, signal }),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60 * 1000,
  })
}

/** Free disk, app quotas and SynCode queue of the host (ADR-0053). */
export function useSvCapacity(workspaceId?: string) {
  return useQuery({
    queryKey: svProjectKeys.capacity(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(svCapacityContract, { query: { workspaceId: workspaceId as string }, signal }),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  })
}

interface SvProjectActionVariables {
  projectId: string
  workspaceId: string
}

/** After a lifecycle action: the list, the app, its size and the capacity changed. */
function useAfterLifecycle() {
  const queryClient = useQueryClient()
  return (variables: SvProjectActionVariables) => {
    queryClient.invalidateQueries({ queryKey: svProjectKeys.list(variables.workspaceId) })
    queryClient.invalidateQueries({ queryKey: svProjectKeys.detail(variables.projectId) })
    queryClient.invalidateQueries({ queryKey: svProjectKeys.size(variables.projectId) })
    queryClient.invalidateQueries({ queryKey: svProjectKeys.capacity(variables.workspaceId) })
  }
}

/** Deletes a vehicle app: run stopped, folder, caches and history removed (ADR-0053). */
export function useDeleteSvProject() {
  const after = useAfterLifecycle()
  return useMutation({
    mutationFn: ({ projectId }: SvProjectActionVariables) =>
      requestJson(svDeleteProjectContract, { params: { id: projectId } }),
    onSettled: (_data, _error, variables) => after(variables),
  })
}

/** Re-creates a failed vehicle app, keeping its workflows. */
export function useRepairSvProject() {
  const after = useAfterLifecycle()
  return useMutation({
    mutationFn: ({ projectId }: SvProjectActionVariables) =>
      requestJson(svRepairProjectContract, { params: { id: projectId } }),
    onSettled: (_data, _error, variables) => after(variables),
  })
}

/** Removes a vehicle app's build outputs; sources stay. */
export function useCleanSvProject() {
  const after = useAfterLifecycle()
  return useMutation({
    mutationFn: ({ projectId }: SvProjectActionVariables) =>
      requestJson(svCleanProjectContract, { params: { id: projectId } }),
    onSettled: (_data, _error, variables) => after(variables),
  })
}

/** Drops apps of archived workspaces and links to vanished apps (the server does it at most once an hour). */
export function useSvReconcile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => requestJson(svReconcileContract, {}),
    onSuccess: (result) => {
      if (result.deletedApps || result.droppedLinks) {
        queryClient.invalidateQueries({ queryKey: svProjectKeys.lists() })
      }
    },
  })
}
