import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  svAiConversationContract,
  svAiConversationsContract,
  svAiStatusContract,
} from '@/lib/api/contracts/sv-ai'

export const svAiKeys = {
  all: ['sv-ai'] as const,
  status: () => [...svAiKeys.all, 'status'] as const,
  lists: () => [...svAiKeys.all, 'conversations'] as const,
  list: (workflowId?: string) => [...svAiKeys.lists(), workflowId ?? ''] as const,
  details: () => [...svAiKeys.all, 'conversation'] as const,
  detail: (id?: string) => [...svAiKeys.details(), id ?? ''] as const,
}

/** Whether an LLM provider is configured (the panel explains how otherwise). */
export function useSvAiStatus() {
  return useQuery({
    queryKey: svAiKeys.status(),
    queryFn: ({ signal }) => requestJson(svAiStatusContract, { signal }),
    staleTime: 60 * 1000,
  })
}

/** The user's conversations about the workflow, most recent first. */
export function useSvAiConversations(workflowId?: string) {
  return useQuery({
    queryKey: svAiKeys.list(workflowId),
    queryFn: async ({ signal }) =>
      (
        await requestJson(svAiConversationsContract, {
          query: { workflowId: workflowId as string },
          signal,
        })
      ).conversations,
    enabled: Boolean(workflowId),
    staleTime: 30 * 1000,
  })
}

/** Loads a conversation (messages for display and its pending action). */
export function fetchSvAiConversation(id: string, signal?: AbortSignal) {
  return requestJson(svAiConversationContract, { params: { id }, signal })
}
