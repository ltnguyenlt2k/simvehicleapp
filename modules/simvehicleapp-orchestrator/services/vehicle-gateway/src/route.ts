import http2 from "node:http2";
import { actuateSignal, batchRequests, grpcFrame, grpcMessages, metadataIds, stringMessage } from "./protobuf.ts";

/**
 * One deployment's way to its target databroker (ADR-0060, M18-T09): an h2c port the deployed app uses as its
 * databroker, forwarding kuksa.val.v2 calls method by method to the target (TLS and token added here, the app knows
 * neither). Reads always pass; Actuate/BatchActuate only in read-write mode and only on the app's actuators;
 * provider methods never. Refused calls and writes are audited.
 */

export type RouteMode = "read-only" | "read-write";

export interface RouteConfig {
  id: string;
  /** `host:port` of the target databroker. */
  target: string;
  tls: boolean;
  token?: string;
  mode: RouteMode;
  /** VSS paths of the actuators the app may set (read-write). */
  actuators: string[];
}

export interface AuditEntry {
  ts: number;
  method: string;
  allowed: boolean;
  signal?: string;
  reason?: string;
}

const V2 = "/kuksa.val.v2.VAL/";
export const READ_METHODS = ["GetValue", "GetValues", "Subscribe", "SubscribeById", "ListMetadata", "GetServerInfo"].map((m) => V2 + m);
export const WRITE_METHODS = ["Actuate", "BatchActuate"].map((m) => V2 + m);
const AUDIT_MAX = 1000;
/** gRPC status codes the route answers itself. */
const PERMISSION_DENIED = 7;
const UNAVAILABLE = 14;

export interface RouteDeps {
  log: { info: (msg: string, f?: Record<string, unknown>) => void; warn: (msg: string, f?: Record<string, unknown>) => void };
  now?: () => number;
}

export class Route {
  readonly audit: AuditEntry[] = [];
  /** Calls forwarded, by method (reads are counted, not audited one by one). */
  readonly forwarded = new Map<string, number>();
  private server?: http2.Http2Server;
  private readonly sessions = new Set<http2.ServerHttp2Session>();
  private session?: http2.ClientHttp2Session;
  private actuatorIds = new Set<number>();
  private readonly now: () => number;

  constructor(
    readonly config: RouteConfig,
    private readonly deps: RouteDeps,
  ) {
    this.now = deps.now ?? Date.now;
  }

  /** Listens on `port` (0: any free port); resolves the actuators' ids on the target when it can. */
  async start(port: number, host = "0.0.0.0"): Promise<number> {
    this.server = http2.createServer();
    this.server.on("stream", (stream, headers) => void this.handle(stream as http2.ServerHttp2Stream, headers));
    this.server.on("sessionError", () => {});
    this.server.on("session", (s) => {
      this.sessions.add(s);
      s.on("close", () => this.sessions.delete(s));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(port, host, () => resolve());
    });
    if (this.config.mode === "read-write" && this.config.actuators.length) await this.resolveIds().catch(() => {});
    return (this.server.address() as { port: number }).port;
  }

  /** Stops the route: the app's connections and the target's are closed at once (a stopped deployment). */
  async close(): Promise<void> {
    this.session?.destroy();
    for (const s of this.sessions) s.destroy();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  private upstream(): http2.ClientHttp2Session {
    if (!this.session || this.session.closed || this.session.destroyed) {
      const s = http2.connect(`${this.config.tls ? "https" : "http"}://${this.config.target}`);
      s.on("error", (e) => {
        this.deps.log.warn("target connection failed", { route: this.config.id, target: this.config.target, err: e.message });
        // Ends the calls waiting on it; the next call connects again.
        s.destroy();
      });
      this.session = s;
    }
    return this.session;
  }

  private headersFor(method: string, from?: http2.IncomingHttpHeaders): http2.OutgoingHttpHeaders {
    const out: http2.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(from ?? {})) if ((!k.startsWith(":") || k === ":method") && k !== "authorization" && v !== undefined) out[k] = v as string;
    out[":method"] = "POST";
    out[":path"] = method;
    out["content-type"] ??= "application/grpc";
    out.te = "trailers";
    if (this.config.token) out.authorization = `Bearer ${this.config.token}`;
    return out;
  }

  /** One unary call to the target (ListMetadata for the actuators' ids, GetServerInfo for Test connection). */
  unary(method: string, message: Uint8Array, timeoutMs = 5000): Promise<{ status: number; message?: string; body: Uint8Array[] }> {
    return new Promise((resolve) => {
      const req = this.upstream().request(this.headersFor(method));
      const chunks: Buffer[] = [];
      let status = UNAVAILABLE;
      let msg: string | undefined = "no answer";
      const timer = setTimeout(() => req.close(http2.constants.NGHTTP2_CANCEL), timeoutMs);
      const take = (h: http2.IncomingHttpHeaders) => {
        if (h["grpc-status"] !== undefined) {
          status = Number(h["grpc-status"]);
          msg = h["grpc-message"] ? decodeURIComponent(String(h["grpc-message"])) : undefined;
        }
      };
      req.on("response", take);
      req.on("trailers", take);
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("error", (e) => {
        msg = e.message;
      });
      req.on("close", () => {
        clearTimeout(timer);
        let body: Uint8Array[] = [];
        try {
          body = grpcMessages(Buffer.concat(chunks));
        } catch {}
        resolve({ status, message: msg, body });
      });
      req.end(Buffer.from(grpcFrame(message)));
    });
  }

  private async resolveIds() {
    for (const path of this.config.actuators) {
      const r = await this.unary(`${V2}ListMetadata`, stringMessage(1, path));
      for (const m of r.body) for (const id of metadataIds(m)) this.actuatorIds.add(id);
    }
  }

  private record(entry: Omit<AuditEntry, "ts">) {
    this.audit.push({ ts: this.now(), ...entry });
    if (this.audit.length > AUDIT_MAX) this.audit.splice(0, this.audit.length - AUDIT_MAX);
    if (!entry.allowed) this.deps.log.info("call refused", { route: this.config.id, ...entry });
  }

  private refuse(stream: http2.ServerHttp2Stream, method: string, reason: string, signal?: string) {
    this.record({ method, allowed: false, reason, ...(signal ? { signal } : {}) });
    if (!stream.closed)
      stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": String(PERMISSION_DENIED), "grpc-message": encodeURIComponent(reason) }, { endStream: true });
  }

  /** The signals a write names, or why it is refused. */
  private checkWrite(method: string, body: Uint8Array): { signals: string[] } | { refused: string; signal?: string } {
    let requests: Uint8Array[];
    try {
      const [message] = grpcMessages(body);
      if (!message) return { refused: "empty request" };
      requests = method.endsWith("/BatchActuate") ? batchRequests(message) : [message];
    } catch (e) {
      return { refused: (e as Error).message };
    }
    const signals: string[] = [];
    for (const r of requests) {
      const s = actuateSignal(r);
      if (s?.path !== undefined) {
        if (!this.config.actuators.includes(s.path)) return { refused: `${s.path} is not an actuator this app may set`, signal: s.path };
        signals.push(s.path);
      } else if (s?.id !== undefined) {
        if (!this.actuatorIds.has(s.id)) return { refused: `signal id ${s.id} is not an actuator this app may set`, signal: `#${s.id}` };
        signals.push(`#${s.id}`);
      } else return { refused: "no signal in the request" };
    }
    return { signals };
  }

  private async handle(stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) {
    stream.on("error", () => {});
    const method = String(headers[":path"] ?? "");
    const read = READ_METHODS.includes(method);
    const write = WRITE_METHODS.includes(method);
    if (!read && !write) return this.refuse(stream, method, `${method} is not allowed for a deployed app`);
    if (write && this.config.mode !== "read-write") return this.refuse(stream, method, `${method}: this deployment is read-only`);

    let body: Buffer | undefined;
    let signals: string[] = [];
    if (write) {
      // Unary: read the whole request, check every signal it sets, then forward it.
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      body = Buffer.concat(chunks);
      const check = this.checkWrite(method, body);
      if ("refused" in check) return this.refuse(stream, method, check.refused, check.signal);
      signals = check.signals;
    }

    let up: http2.ClientHttp2Stream;
    try {
      up = this.upstream().request(this.headersFor(method, headers));
    } catch (e) {
      if (!stream.closed) stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": String(UNAVAILABLE), "grpc-message": encodeURIComponent((e as Error).message) }, { endStream: true });
      return;
    }
    this.forwarded.set(method, (this.forwarded.get(method) ?? 0) + 1);
    if (write) for (const s of signals) this.record({ method, allowed: true, signal: s });
    if (body) up.end(body);
    else stream.pipe(up);

    up.on("response", (h, flags) => {
      const resp: http2.OutgoingHttpHeaders = {};
      for (const [k, v] of Object.entries(h)) if ((k === ":status" || !k.startsWith(":")) && v !== undefined) resp[k] = v as string;
      if (stream.closed) return;
      // Trailers-only (an error without a message): the status is in these headers, nothing follows.
      if ("grpc-status" in h || flags & http2.constants.NGHTTP2_FLAG_END_STREAM) return stream.respond(resp, { endStream: true });
      stream.respond(resp, { waitForTrailers: true });
      up.pipe(stream);
    });
    let trailers: http2.OutgoingHttpHeaders = {};
    up.on("trailers", (t) => (trailers = { ...t }));
    stream.on("wantTrailers", () => stream.sendTrailers(trailers));
    // Either side may cancel (an app ending a Subscribe): close the other one.
    stream.on("close", () => !up.closed && up.close(http2.constants.NGHTTP2_CANCEL));
    // The target went away before answering (refused connection, reset): the app gets UNAVAILABLE.
    up.on("close", () => {
      if (!stream.closed && !stream.headersSent)
        stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": String(UNAVAILABLE), "grpc-message": encodeURIComponent("the deploy target does not answer") }, { endStream: true });
    });
    up.on("error", (e) => {
      if (stream.closed) return;
      if (!stream.headersSent) stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": String(UNAVAILABLE), "grpc-message": encodeURIComponent(e.message) }, { endStream: true });
      else stream.close(http2.constants.NGHTTP2_CANCEL);
    });
  }
}
