import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SvCatalogNodesResponse,
  type SvCatalogReleasesResponse,
  type SvVssNodeKind,
  svCatalogNodesContract,
  svCatalogReleasesContract,
  svCatalogSearchContract,
  svCatalogTreeContract,
} from '@/lib/api/contracts/sv'

/** A VSS release never changes once published, so its data is cached for the session. */
const CATALOG_STALE_TIME = 60 * 60 * 1000

export const svCatalogKeys = {
  all: ['sv-catalog'] as const,
  releases: () => [...svCatalogKeys.all, 'releases'] as const,
  trees: () => [...svCatalogKeys.all, 'tree'] as const,
  tree: (release?: string, prefix?: string) =>
    [...svCatalogKeys.trees(), release ?? '', prefix ?? ''] as const,
  searches: () => [...svCatalogKeys.all, 'search'] as const,
  search: (release?: string, q?: string, type?: SvVssNodeKind) =>
    [...svCatalogKeys.searches(), release ?? '', q ?? '', type ?? ''] as const,
  nodes: () => [...svCatalogKeys.all, 'nodes'] as const,
  node: (release?: string, path?: string) =>
    [...svCatalogKeys.nodes(), release ?? '', path ?? ''] as const,
}

export function useSvCatalogReleases() {
  return useQuery({
    queryKey: svCatalogKeys.releases(),
    queryFn: ({ signal }): Promise<SvCatalogReleasesResponse> =>
      requestJson(svCatalogReleasesContract, { signal }),
    staleTime: CATALOG_STALE_TIME,
  })
}

/** One level of the VSS tree below `prefix` (below `Vehicle` when omitted). */
export function useSvCatalogTree(release?: string, prefix?: string, enabled = true) {
  return useQuery({
    queryKey: svCatalogKeys.tree(release, prefix),
    queryFn: ({ signal }): Promise<SvCatalogNodesResponse> =>
      requestJson(svCatalogTreeContract, { query: { release, prefix, depth: 1 }, signal }),
    enabled,
    staleTime: CATALOG_STALE_TIME,
  })
}

export function useSvCatalogSearch(release: string | undefined, q: string, type?: SvVssNodeKind) {
  const query = q.trim()
  return useQuery({
    queryKey: svCatalogKeys.search(release, query, type),
    queryFn: ({ signal }): Promise<SvCatalogNodesResponse> =>
      requestJson(svCatalogSearchContract, { query: { q: query, type, release }, signal }),
    enabled: query.length > 0,
    staleTime: CATALOG_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

/** Catalog entry of a single saved path (type/unit/allowed for the locked selector card). */
export function useSvCatalogNode(release: string | undefined, path: string | undefined) {
  return useQuery({
    queryKey: svCatalogKeys.node(release, path),
    queryFn: async ({ signal }) => {
      const data = await requestJson(svCatalogNodesContract, {
        query: { paths: path as string, release },
        signal,
      })
      return { release: data.release, node: data.nodes[0] ?? null }
    },
    enabled: Boolean(path),
    staleTime: CATALOG_STALE_TIME,
  })
}
