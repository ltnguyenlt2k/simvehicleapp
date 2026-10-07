import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { svSystemStatusContract } from '@/lib/api/contracts/sv'

export const svSystemKeys = {
  all: ['sv-system'] as const,
  status: () => [...svSystemKeys.all, 'status'] as const,
}

/** Every SimVehicleApp service with health and version, refreshed while the page is open. */
export function useSvSystemStatus() {
  return useQuery({
    queryKey: svSystemKeys.status(),
    queryFn: ({ signal }) => requestJson(svSystemStatusContract, { signal }),
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
  })
}
