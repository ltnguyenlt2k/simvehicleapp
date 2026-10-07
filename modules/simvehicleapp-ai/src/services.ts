import { internalHeaders } from "@simvehicleapp/service-kit";

/** Internal services the tools call (ADR-0007 dependency matrix: ai → core, orchestrator, signal-gateway). */
export interface ServiceUrls {
  catalog: string;
  compiler: string;
  orchestrator: string;
  signalGateway: string;
  secret: string;
}

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface Services {
  get(service: keyof Omit<ServiceUrls, "secret">, path: string, timeoutMs?: number): Promise<unknown>;
  post(service: keyof Omit<ServiceUrls, "secret">, path: string, body: unknown, timeoutMs?: number): Promise<unknown>;
  /** Raw response (SSE reads). */
  raw(service: keyof Omit<ServiceUrls, "secret">, path: string, init?: RequestInit): Promise<Response>;
}

export function httpServices(u: ServiceUrls): Services {
  const call = async (service: keyof Omit<ServiceUrls, "secret">, path: string, init: RequestInit & { timeoutMs?: number } = {}) => {
    const res = await fetch(`${u[service]}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(init.timeoutMs ?? 15_000),
      headers: { ...internalHeaders(undefined, u.secret), "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    return res;
  };
  const json = async (res: Response, what: string) => {
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = Array.isArray(body) ? body.map((d: { message?: string }) => d.message).join("; ") : ((body as { message?: string; error?: string } | null)?.message ?? (body as { error?: string } | null)?.error ?? "");
      throw new ServiceError(`${what} ⇒ ${res.status}${msg ? `: ${msg}` : ""}`, res.status, body);
    }
    return body;
  };
  return {
    async get(service, path, timeoutMs) {
      return json(await call(service, path, { timeoutMs }), `${service} GET ${path.split("?")[0]}`);
    },
    async post(service, path, body, timeoutMs) {
      return json(await call(service, path, { method: "POST", body: JSON.stringify(body), timeoutMs }), `${service} POST ${path}`);
    },
    raw(service, path, init) {
      return call(service, path, init ?? {});
    },
  };
}
