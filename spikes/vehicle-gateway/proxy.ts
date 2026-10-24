/**
 * Spike M18-T09 (ADR-0060 §9.2): a gRPC proxy over HTTP/2 cleartext that forwards only allowed methods to a target
 * databroker, streams both ways, and answers a refused method with gRPC status PERMISSION_DENIED (7) itself.
 * Bun runs `node:http2`; run: bun proxy.ts <listen-port> <target host:port> [read-only|read-write]
 */
import http2 from "node:http2";

const [port = "55560", target = "databroker:55555", mode = "read-only"] = process.argv.slice(2);
const V2 = "/kuksa.val.v2.VAL/";
const READ = ["GetValue", "GetValues", "Subscribe", "SubscribeById", "ListMetadata", "GetServerInfo"].map((m) => V2 + m);
const WRITE = ["Actuate", "BatchActuate"].map((m) => V2 + m);
const allowed = new Set(mode === "read-write" ? [...READ, ...WRITE] : READ);

const upstream = http2.connect(`http://${target}`);
upstream.on("error", (e) => console.error("upstream", e.message));
const audit: { path: string; allowed: boolean; ts: number }[] = [];

const server = http2.createServer();
server.on("stream", (stream, headers) => {
  const path = String(headers[":path"]);
  const ok = allowed.has(path);
  audit.push({ path, allowed: ok, ts: Date.now() });
  console.log(`${ok ? "→" : "✕"} ${path}`);
  if (path === "/_audit") {
    stream.respond({ ":status": 200, "content-type": "application/json" });
    return stream.end(JSON.stringify(audit));
  }
  if (!ok) {
    // A gRPC error without a body: trailers-only response.
    stream.respond({ ":status": 200, "content-type": "application/grpc", "grpc-status": "7", "grpc-message": `${path} is not allowed by this deployment` }, { endStream: true });
    return;
  }
  const out: http2.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(headers)) if (!k.startsWith(":") || k === ":path" || k === ":method") out[k] = v as string;
  const up = upstream.request(out);
  stream.pipe(up);
  up.on("response", (h, flags) => {
    const resp: http2.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(h)) if (k === ":status" || !k.startsWith(":")) resp[k] = v as string;
    // Trailers-only (a gRPC error with no message): the status is in these headers, nothing follows.
    if ("grpc-status" in h || flags & http2.constants.NGHTTP2_FLAG_END_STREAM) {
      if (!stream.closed) stream.respond(resp, { endStream: true });
      return;
    }
    stream.respond(resp, { waitForTrailers: true });
    up.pipe(stream);
  });
  let trailers: http2.OutgoingHttpHeaders = {};
  up.on("trailers", (t) => (trailers = { ...t }));
  stream.on("wantTrailers", () => stream.sendTrailers(trailers));
  // Either side may cancel (a client ending a Subscribe): close the other, never crash the proxy.
  stream.on("close", () => !up.closed && up.close(http2.constants.NGHTTP2_CANCEL));
  stream.on("error", () => {});
  up.on("error", () => !stream.closed && stream.close(http2.constants.NGHTTP2_CANCEL));
});
server.listen(Number(port), () => console.log(`proxy :${port} → ${target} (${mode})`));
