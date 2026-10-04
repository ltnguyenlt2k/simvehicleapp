import { internalHeaders } from "@simvehicleapp/service-kit";
import type { VehicleLookup } from "@simvehicleapp/compiler";
import type { VssNode } from "@simvehicleapp/vss";

export class CatalogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogUnavailableError";
  }
}

/** vss-catalog accepts at most 2000 paths per `/nodes` call (openapi/vss-catalog.v1.yaml). */
const CHUNK = 2000;

/**
 * `VehicleLookup` over `vss-catalog GET /nodes` (ADR-0010 §1: the compiler never parses VSS itself).
 * Unknown paths come back in `unknown` and map to `null`; an unknown release maps every path to `null`.
 */
export function catalogVehicleLookup(opts: {
  baseUrl: string;
  secret: string;
  requestId?: () => string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): VehicleLookup {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const base = opts.baseUrl.replace(/\/+$/, "");
  return async (release, paths) => {
    const result = new Map<string, VssNode | null>();
    for (let i = 0; i < paths.length; i += CHUNK) {
      const chunk = paths.slice(i, i + CHUNK);
      const qs = new URLSearchParams({ release, paths: chunk.join(",") });
      let res: Response;
      try {
        res = await doFetch(`${base}/nodes?${qs}`, {
          headers: internalHeaders(opts.requestId?.() ?? crypto.randomUUID(), opts.secret),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
        });
      } catch (e) {
        throw new CatalogUnavailableError(`vss-catalog unreachable: ${(e as Error).message}`);
      }
      if (res.status === 404) {
        for (const p of chunk) result.set(p, null);
        continue;
      }
      if (!res.ok) throw new CatalogUnavailableError(`vss-catalog answered HTTP ${res.status}`);
      const body = (await res.json()) as { nodes: VssNode[]; unknown?: string[] };
      for (const n of body.nodes) result.set(n.path, n);
      for (const p of body.unknown ?? []) result.set(p, null);
    }
    return result;
  };
}
