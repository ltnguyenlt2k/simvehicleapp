import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { type SvLintResponse, svLintContract } from '@/lib/api/contracts/sv'

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

/** Lint of a WorkflowGraph (debounce upstream, analysis/05 §4: 300 ms). */
export function useSvLint(workflowId: string | undefined, graphJson: string | undefined) {
  return useQuery({
    queryKey: svLintKeys.result(workflowId, graphJson),
    queryFn: ({ signal }) => fetchLint(graphJson as string, signal),
    enabled: Boolean(workflowId && graphJson),
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    retry: false,
  })
}
