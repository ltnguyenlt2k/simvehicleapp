/**
 * The few protobuf and gRPC framing pieces the vehicle-gateway reads (ADR-0060): the signal of an Actuate request,
 * and the ids ListMetadata returns. Wire format only (varint, length-delimited), no schema compiler.
 */

export interface Field {
  no: number;
  /** 0 varint, 2 length-delimited; others are skipped. */
  wire: number;
  int?: bigint;
  bytes?: Uint8Array;
}

function varint(buf: Uint8Array, at: number): [bigint, number] {
  let v = 0n;
  let shift = 0n;
  for (let i = at; i < buf.length; i++) {
    const b = buf[i]!;
    v |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [v, i + 1];
    shift += 7n;
    if (shift > 63n) break;
  }
  throw new Error("bad varint");
}

/** Fields of one message, in order. */
export function fields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let at = 0;
  while (at < buf.length) {
    const [key, next] = varint(buf, at);
    at = next;
    const no = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [v, n] = varint(buf, at);
      out.push({ no, wire, int: v });
      at = n;
    } else if (wire === 2) {
      const [len, n] = varint(buf, at);
      const end = n + Number(len);
      if (end > buf.length) throw new Error("truncated field");
      out.push({ no, wire, bytes: buf.subarray(n, end) });
      at = end;
    } else if (wire === 1) at += 8;
    else if (wire === 5) at += 4;
    else throw new Error(`unsupported wire type ${wire}`);
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function writeVarint(v: number): number[] {
  const out: number[] = [];
  let x = v >>> 0;
  while (x > 0x7f) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
  return out;
}

/** A message holding one string field. */
export function stringMessage(no: number, value: string): Uint8Array {
  const b = enc.encode(value);
  return Uint8Array.from([...writeVarint((no << 3) | 2), ...writeVarint(b.length), ...b]);
}

/** gRPC length-prefixed messages of a body (not compressed). */
export function grpcMessages(body: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let at = 0;
  while (at + 5 <= body.length) {
    if (body[at] !== 0) throw new Error("compressed gRPC messages are not supported");
    const len = new DataView(body.buffer, body.byteOffset + at + 1, 4).getUint32(0);
    out.push(body.subarray(at + 5, at + 5 + len));
    at += 5 + len;
  }
  return out;
}

export function grpcFrame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}

/** The signal an ActuateRequest names: `{ path }` or `{ id }` (SignalID oneof: id = 1, path = 2). */
export function actuateSignal(request: Uint8Array): { path?: string; id?: number } | null {
  const signal = fields(request).find((f) => f.no === 1 && f.wire === 2);
  if (!signal?.bytes) return null;
  for (const f of fields(signal.bytes)) {
    if (f.no === 2 && f.bytes) return { path: dec.decode(f.bytes) };
    if (f.no === 1 && f.int !== undefined) return { id: Number(f.int) };
  }
  return null;
}

/** The ActuateRequests of a BatchActuateRequest (field 1, repeated). */
export function batchRequests(request: Uint8Array): Uint8Array[] {
  return fields(request).flatMap((f) => (f.no === 1 && f.bytes ? [f.bytes] : []));
}

/** Ids in a ListMetadataResponse (metadata = 1; Metadata.id = 10). */
export function metadataIds(response: Uint8Array): number[] {
  return fields(response).flatMap((f) =>
    f.no === 1 && f.bytes ? fields(f.bytes).flatMap((m) => (m.no === 10 && m.int !== undefined ? [Number(m.int)] : [])) : [],
  );
}
