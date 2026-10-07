import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type SvLintResponse, svLintContract, svVerifyContract } from '@/lib/api/contracts/sv'

export const svLintKeys = {
  all: ['sv-lint'] as const,
  results: () => [...svLintKeys.all, 'result'] as const,
  /** Keyed by the graph JSON itself: the same graph is never linted twice. */
  result: (workflowId?: string, graphJson?: string) =>
    [...svLintKeys.results(), workflowId ?? '', graphJson ?? ''] as const,
}

async function fetchLint(graphJson: string, signal?: AbortSignal): Promise<SvLintResponse> {
  return requestJson(svLintContract, {
    body: { graph: JSON.parse(graphJson) as Record<string, unknown> },
    signal,
  })
}

/** While the compiler is unavailable the same graph is linted again this often, so the panel recovers by itself. */
export const SV_LINT_RECOVERY_MS = 5000

/**
 * Lint of a WorkflowGraph (debounce upstream, analysis/05 §4: 300 ms). A failed lint is retried every
 * {@link SV_LINT_RECOVERY_MS} — without it "Checks unavailable" stayed until the next edit (M15 outage E2E).
 */
export function useSvLint(workflowId: string | undefined, graphJson: string | undefined) {
  return useQuery({
    queryKey: svLintKeys.result(workflowId, graphJson),
    queryFn: ({ signal }) => fetchLint(graphJson as string, signal),
    enabled: Boolean(workflowId && graphJson),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
    refetchInterval: (query) => (query.state.status === 'error' ? SV_LINT_RECOVERY_MS : false),
  })
}

/** Verify (M04-T11): every compiler check on the graph currently on the canvas. */
export function useSvVerify() {
  return useMutation({
    mutationFn: async (graphJson: string): Promise<SvLintResponse> =>
      requestJson(svVerifyContract, {
        body: { graph: JSON.parse(graphJson) as Record<string, unknown> },
      }),
  })
}
