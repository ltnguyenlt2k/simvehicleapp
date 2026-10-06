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
