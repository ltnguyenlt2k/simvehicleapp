/**
 * Minimal MQTT 3.1.1 publisher (QoS 0) for scenario topic inputs (M08-T07): CONNECT, wait CONNACK,
 * PUBLISH, DISCONNECT on a fresh connection per message. Enough for mosquitto in the dev stack
 * (ADR-0024 §2, no auth) without a client library.
 */

const enc = new TextEncoder();

function remainingLength(n: number): number[] {
  const out: number[] = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return out;
}

const str = (s: string) => {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 0xff, ...b];
};

export function connectPacket(clientId: string): Uint8Array {
  // protocol "MQTT", level 4, clean session, keep-alive 30 s
  const body = [...str("MQTT"), 4, 0x02, 0, 30, ...str(clientId)];
  return Uint8Array.from([0x10, ...remainingLength(body.length), ...body]);
}

export function publishPacket(topic: string, payload: string): Uint8Array {
  const body = [...str(topic), ...enc.encode(payload)];
  return Uint8Array.from([0x30, ...remainingLength(body.length), ...body]);
}

export const DISCONNECT = Uint8Array.from([0xe0, 0x00]);

export type Publish = (topic: string, payload: string) => Promise<void>;

/** Publisher for `mqtt://host:port`. */
export function mqttPublisher(url: string, clientId = "sv-signal-gateway"): Publish {
  const u = new URL(url);
  const port = Number(u.port || 1883);
  return (topic, payload) =>
    new Promise<void>((resolve, reject) => {
      let done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        err ? reject(err) : resolve();
      };
      const timer = setTimeout(() => finish(new Error(`MQTT ${url}: no CONNACK within 5 s`)), 5000);
      Bun.connect({
        hostname: u.hostname,
        port,
        socket: {
          open(socket) {
            socket.write(connectPacket(`${clientId}-${Math.random().toString(36).slice(2, 8)}`));
          },
          data(socket, data) {
            // CONNACK: 0x20 0x02 <flags> <return code>
            if (data[0] !== 0x20 || data[3] !== 0) {
              socket.end();
              return finish(new Error(`MQTT ${url}: connection refused (${data[3]})`));
            }
            socket.write(publishPacket(topic, payload));
            socket.write(DISCONNECT);
            socket.end();
            finish();
          },
          error(_socket, err) {
            finish(err);
          },
          connectError(_socket, err) {
            finish(err);
          },
        },
      }).catch((err: Error) => finish(err));
    });
}

const dec = new TextDecoder();

export function subscribePacket(packetId: number, filter: string): Uint8Array {
  const body = [packetId >> 8, packetId & 0xff, ...str(filter), 0];
  return Uint8Array.from([0x82, ...remainingLength(body.length), ...body]);
}

export const PINGREQ = Uint8Array.from([0xc0, 0x00]);

export interface MqttPacket {
  type: number;
  flags: number;
  body: Uint8Array;
}

/** Whole packets at the start of `buf` and the bytes left for the next read (TCP splits and joins packets). */
export function parsePackets(buf: Uint8Array): { packets: MqttPacket[]; rest: Uint8Array } {
  const packets: MqttPacket[] = [];
  let i = 0;
  for (;;) {
    if (buf.length - i < 2) break;
    let len = 0;
    let mul = 1;
    let j = i + 1;
    let complete = false;
    for (; j < buf.length && j < i + 5; j++) {
      len += (buf[j]! & 0x7f) * mul;
      mul *= 128;
      if ((buf[j]! & 0x80) === 0) {
        complete = true;
        break;
      }
    }
    if (!complete) break;
    const start = j + 1;
    if (buf.length - start < len) break;
    packets.push({ type: buf[i]! >> 4, flags: buf[i]! & 0x0f, body: buf.slice(start, start + len) });
    i = start + len;
  }
  return { packets, rest: buf.slice(i) };
}

/** Topic and payload of a PUBLISH packet (QoS 0 has no packet id; QoS 1/2 do). */
export function parsePublish(p: MqttPacket): { topic: string; payload: string } {
  const tlen = (p.body[0]! << 8) | p.body[1]!;
  const topic = dec.decode(p.body.slice(2, 2 + tlen));
  const qos = (p.flags >> 1) & 0x03;
  return { topic, payload: dec.decode(p.body.slice(2 + tlen + (qos > 0 ? 2 : 0))) };
}

export type Subscribe = (filter: string, onMessage: (topic: string, payload: string) => void, onError: (e: Error) => void) => () => void;

/**
 * Subscriber for `mqtt://host:port` (Messages of the Live tab, ADR-0058 §6): one connection per subscription,
 * SUBSCRIBE QoS 0 after CONNACK, PINGREQ every 20 s; the returned function disconnects.
 */
export function mqttSubscriber(url: string, clientId = "sv-signal-gateway-sub"): Subscribe {
  const u = new URL(url);
  const port = Number(u.port || 1883);
  return (filter, onMessage, onError) => {
    let closed = false;
    let sock: { write(b: Uint8Array): void; end(): void } | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;
    let buf: Uint8Array = new Uint8Array(0);
    const fail = (e: Error) => {
      if (!closed) onError(e);
      stop();
    };
    const stop = () => {
      closed = true;
      if (ping) clearInterval(ping);
      try {
        sock?.write(DISCONNECT);
        sock?.end();
      } catch {}
    };
    Bun.connect({
      hostname: u.hostname,
      port,
      socket: {
        open(socket) {
          sock = socket;
          if (closed) {
            socket.end();
            return;
          }
          socket.write(connectPacket(`${clientId}-${Math.random().toString(36).slice(2, 8)}`));
        },
        data(socket, data) {
          const joined = new Uint8Array(buf.length + data.length);
          joined.set(buf);
          joined.set(data, buf.length);
          const { packets, rest } = parsePackets(joined);
          buf = rest;
          for (const p of packets) {
            if (p.type === 2) {
              if (p.body[1] !== 0) return fail(new Error(`MQTT ${url}: connection refused (${p.body[1]})`));
              socket.write(subscribePacket(1, filter));
              ping = setInterval(() => !closed && socket.write(PINGREQ), 20_000);
            } else if (p.type === 3) {
              const m = parsePublish(p);
              onMessage(m.topic, m.payload);
            }
          }
        },
        close() {
          if (!closed) fail(new Error(`MQTT ${url}: connection closed`));
        },
        error(_socket, err) {
          fail(err);
        },
        connectError(_socket, err) {
          fail(err);
        },
      },
    }).catch((err: Error) => fail(err));
    return stop;
  };
}
