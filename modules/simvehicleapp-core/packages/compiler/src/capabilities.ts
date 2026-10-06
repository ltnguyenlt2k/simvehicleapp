import type { BackendCapabilitiesV1, DiagnosticV1 } from "@simvehicleapp/contracts";
import { diag } from "./diagnostics.ts";

/**
 * S7 backend capability (analysis/06 §3, ADR-0020): the IR version and every trigger/node opcode and
 * concurrency policy must be supported by the target backend. Expression operators (`$expr`) are part
 * of an IR version: a backend that declares an IR version implements all of them.
 */

/** Capabilities of a backend by id (`GET /capabilities`); `null` = no such backend. */
export type CapabilitiesLookup = (backend: string) => Promise<BackendCapabilitiesV1 | null>;

export class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendUnavailableError";
  }
}

/** The parts of an IR document S7 looks at. */
export interface IrForCapabilities {
  irVersion: string;
  workflowId: string;
  triggers: { opcode: string; concurrency?: { policy: string }; src: { blockId: string } }[];
  nodes: { opcode: string; src: { blockId: string; inserted?: boolean } }[];
}

export async function checkBackend(ir: IrForCapabilities, backend: string, lookup: CapabilitiesLookup): Promise<DiagnosticV1[]> {
  const wf = ir.workflowId;
  let caps: BackendCapabilitiesV1 | null;
  try {
    caps = await lookup(backend);
  } catch (e) {
    return [diag("BACKEND_UNAVAILABLE", wf, { message: `The ${backend} code generator is not reachable`, data: { backend, error: (e as Error).message } })];
  }
  if (!caps) return [diag("BACKEND_UNAVAILABLE", wf, { message: `There is no ${backend} code generator`, data: { backend, reason: "unknown_backend" } })];

  if (!Bun.semver.satisfies(ir.irVersion, caps.irVersions)) {
    return [diag("IR_VERSION_UNSUPPORTED", wf, { message: `${caps.name} ${caps.version} supports IR ${caps.irVersions}, not ${ir.irVersion}`, data: { backend, irVersion: ir.irVersion, supported: caps.irVersions } })];
  }
  const opcodes = new Set<string>(caps.opcodes);
  const policies = new Set<string>(caps.features.concurrencyPolicies);
  // One diagnostic per (block, opcode, policy): a block may lower to several nodes.
  const found = new Map<string, { blockId: string; data: Record<string, string> }>();
  const add = (blockId: string, data: Record<string, string>) => {
    const key = `${blockId}\u0000${data.opcode}\u0000${data.policy ?? ""}`;
    if (!found.has(key)) found.set(key, { blockId, data });
  };
  for (const t of ir.triggers) {
    if (!opcodes.has(t.opcode)) add(t.src.blockId, { opcode: t.opcode });
    else if (t.concurrency && !policies.has(t.concurrency.policy)) add(t.src.blockId, { opcode: t.opcode, reason: "concurrency", policy: t.concurrency.policy });
  }
  for (const n of ir.nodes) if (!opcodes.has(n.opcode)) add(n.src.blockId, { opcode: n.opcode });
  return [...found.values()].map(({ blockId, data }) => {
    const what = data.reason === "concurrency" ? `the '${data.policy}' policy of ${data.opcode}` : data.opcode;
    return diag("OPCODE_UNSUPPORTED_BY_BACKEND", wf, { blockId, message: `${caps.name} ${caps.version} does not support ${what} yet`, data: { backend, ...data } });
  });
}

/**
 * `CapabilitiesLookup` over HTTP with a per-backend cache (capabilities change only when a backend is
 * redeployed). Unknown backend ids ⇒ `null`; network/HTTP errors ⇒ BackendUnavailableError (not cached).
 */
export function httpCapabilities(opts: {
  /** backend id → base URL of its compiler-code service. */
  backends: Readonly<Record<string, string>>;
  headers?: () => Record<string, string>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  ttlMs?: number;
  now?: () => number;
  timeoutMs?: number;
}): CapabilitiesLookup {
  const doFetch = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? 60_000;
  const cache = new Map<string, { at: number; caps: BackendCapabilitiesV1 }>();
  return async (backend) => {
    if (!Object.hasOwn(opts.backends, backend)) return null;
    const hit = cache.get(backend);
    if (hit && now() - hit.at < ttl) return hit.caps;
    let res: Response;
    try {
      res = await doFetch(`${opts.backends[backend]!.replace(/\/+$/, "")}/capabilities`, {
        headers: opts.headers?.() ?? {},
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
    } catch (e) {
      throw new BackendUnavailableError(`${backend} unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) throw new BackendUnavailableError(`${backend} answered HTTP ${res.status}`);
    const caps = (await res.json()) as BackendCapabilitiesV1;
    cache.set(backend, { at: now(), caps });
    return caps;
  };
}
