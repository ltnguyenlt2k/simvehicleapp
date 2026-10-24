/** Test helpers: a databroker stand-in and a raw gRPC client (no grpc-js in this service). */
import http2 from "node:http2";
import { grpcFrame, grpcMessages, stringMessage } from "./protobuf.ts";

export const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";
export const len = (no: number, inner: Uint8Array) => Uint8Array.from([(no << 3) | 2, inner.length, ...inner]);
export const actuateByPath = (path: string) => len(1, stringMessage(2, path));
export const actuateById = (id: number) => len(1, Uint8Array.from([0x08, id]));

/** A databroker stand-in: answers the v2 methods the tests call and records what reached it. */
export function fakeTarget() {
  const seen: { method: string; authorization?: string }[] = [];
  const server = http2.createServer();
  server.on("stream", async (raw, headers) => {
    const stream = raw as http2.ServerHttp2Stream;
    const method = String(headers[":path"]);
    seen.push({ method, authorization: headers.authorization as string | undefined });
    const chunks: Buffer[] = [];
    if (method.endsWith("/Subscribe")) {
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
      stream.write(grpcFrame(stringMessage(1, "a")));
      stream.write(grpcFrame(stringMessage(1, "b")));
      return void stream.end();
    }
    for await (const c of stream) chunks.push(c as Buffer);
    stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
    stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));
    if (method.endsWith("/ListMetadata")) {
      // metadata { id: 65 } for the hazard path only
      const asked = new TextDecoder().decode(grpcMessages(Buffer.concat(chunks))[0]!.subarray(2));
      return void stream.end(asked === HAZARD ? grpcFrame(len(1, Uint8Array.from([0x50, 65]))) : grpcFrame(new Uint8Array()));
    }
    if (method.endsWith("/GetServerInfo")) return void stream.end(grpcFrame(Uint8Array.from([...stringMessage(1, "databroker"), ...stringMessage(2, "0.5.0")])));
    stream.end(grpcFrame(new Uint8Array()));
  });
  return new Promise<{ port: number; seen: typeof seen; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as { port: number }).port, seen, close: () => server.close() })),
  );
}

/** A raw gRPC call: status, message and the messages received. */
export function call(port: number, method: string, message = new Uint8Array()) {
  return new Promise<{ status: number; message?: string; messages: number }>((resolve) => {
    const client = http2.connect(`http://127.0.0.1:${port}`);
    // A closed route: no connection, no gRPC status.
    client.on("error", () => resolve({ status: -1, messages: 0 }));
    const req = client.request({ ":method": "POST", ":path": method.startsWith("/") ? method : `/kuksa.val.v2.VAL/${method}`, "content-type": "application/grpc", te: "trailers" });
    let status = -1;
    let msg: string | undefined;
    const chunks: Buffer[] = [];
    const take = (h: http2.IncomingHttpHeaders) => {
      if (h["grpc-status"] !== undefined) {
        status = Number(h["grpc-status"]);
        msg = h["grpc-message"] ? decodeURIComponent(String(h["grpc-message"])) : undefined;
      }
    };
    req.on("response", take);
    req.on("trailers", take);
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", () => {});
    req.on("close", () => {
      client.close();
      resolve({ status, message: msg, messages: grpcMessages(Buffer.concat(chunks)).length });
    });
    req.end(Buffer.from(grpcFrame(message)));
  });
}

