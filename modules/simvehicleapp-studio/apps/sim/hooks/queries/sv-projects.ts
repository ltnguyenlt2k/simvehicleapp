import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvCreateProjectBody,
  type SvGeneration,
  type SvProject,
  type SvStartGenerationBody,
  svCreateProjectContract,
  svGetGenerationContract,
  svGetProjectContract,
  svListProjectsContract,
  svProjectFileContract,
  svProjectFilesContract,
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
    onSettled: (_data, _error, body) =>
      queryClient.invalidateQueries({ queryKey: svProjectKeys.list(body.workspaceId) }),
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
