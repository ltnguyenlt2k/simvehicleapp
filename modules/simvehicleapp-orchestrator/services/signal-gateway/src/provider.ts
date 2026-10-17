import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";

/**
 * The signal-gateway as `kuksa.val.v2` provider of a run's actuators (ADR-0047 §2, M14 #5): an app on the v2 API
 * actuates through the databroker, which hands the request to the provider; the gateway accepts it and publishes the
 * requested value as the current one — what the v1 mirror (target → current) does for apps on `sdv.databroker.v1`.
 * One provider stream per run; closing it releases the actuators (ALREADY_EXISTS while another provider holds one).
 */

const PROTO_DIR = fileURLToPath(new URL("../proto", import.meta.url));

type SignalId = { id?: number; path?: string; signal?: string };
type ActuateRequest = { signal_id?: SignalId; value?: unknown };
export type ProviderMessage = {
  action?: string;
  provide_actuation_response?: object;
  publish_values_response?: { request_id?: number; status?: Record<string, { code?: string; message?: string }> };
  batch_actuate_stream_request?: { actuate_requests?: ActuateRequest[] };
};

/** The bidi stream of OpenProviderStream (a fake in tests). */
export interface ProviderStream {
  write(msg: unknown): void;
  on(event: "data", cb: (m: ProviderMessage) => void): void;
  on(event: "error", cb: (e: Error & { code?: number }) => void): void;
  cancel(): void;
}

export interface ProviderApi {
  /** Numeric id of a signal (`ListMetadata` with the signal as root: v2 actuations carry ids, not paths). */
  idOf(path: string): Promise<number>;
  open(): ProviderStream;
  close(): void;
}

export interface Provider {
  /** Actuations accepted and published as current values so far. */
  readonly provided: number;
  stop(): void;
}

export class ProviderRejected extends Error {}

/** Starts providing `paths`; resolves once the databroker accepted the claim (rejects with its reason). */
export async function provideActuators(api: ProviderApi, paths: string[], log: { warn(msg: string, data?: object): void }, onEnd: (e: Error) => void = () => {}): Promise<Provider> {
  const ids = new Map<number, string>();
  for (const p of paths) ids.set(await api.idOf(p), p);
  const stream = api.open();
  let requestId = 0;
  let provided = 0;
  let stopped = false;
  const accepted = new Promise<void>((resolve, reject) => {
    stream.on("data", (m) => {
      if (m.provide_actuation_response) return resolve();
      if (m.publish_values_response?.status && Object.keys(m.publish_values_response.status).length) {
        log.warn("provider publish refused", { status: m.publish_values_response.status });
        return;
      }
      for (const req of m.batch_actuate_stream_request?.actuate_requests ?? []) {
        const id = req.signal_id?.id ?? [...ids].find(([, p]) => p === req.signal_id?.path)?.[0];
        if (id === undefined || !ids.has(id)) {
          stream.write({ batch_actuate_stream_response: { signal_id: req.signal_id, error: { code: "ERROR_CODE_NOT_FOUND", message: "not provided here" } } });
          continue;
        }
        stream.write({ batch_actuate_stream_response: { signal_id: { id }, error: { code: "ERROR_CODE_OK", message: "" } } });
        stream.write({ publish_values_request: { request_id: ++requestId, data_points: { [id]: { value: req.value } } } });
        provided++;
      }
    });
    stream.on("error", (e) => {
      if (stopped) return;
      const err = e.code === grpc.status.ALREADY_EXISTS ? new ProviderRejected(`another provider already holds one of ${paths.join(", ")}`) : new ProviderRejected(e.message);
      reject(err);
      onEnd(err);
    });
  });
  stream.write({ provide_actuation_request: { actuator_identifiers: paths.map((path) => ({ path })) } });
  await accepted;
  return {
    get provided() {
      return provided;
    },
    stop() {
      stopped = true;
      stream.cancel();
    },
  };
}

/** `kuksa.val.v2` of one databroker (`host:port`, insecure as in the dev stack). */
export function grpcProviderApi(address: string): ProviderApi {
  const def = loader.loadSync("kuksa/val/v2/val.proto", { includeDirs: [PROTO_DIR], keepCase: true, longs: String, enums: String, defaults: false, oneofs: true });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const client = new pkg.kuksa.val.v2.VAL(address, grpc.credentials.createInsecure(), { "grpc.use_local_subchannel_pool": 1 });
  return {
    idOf: (path) =>
      new Promise((resolve, reject) =>
        // waitForReady: a channel in backoff (the databroker was restarted) reconnects instead of failing at once.
        client.ListMetadata({ root: path }, { deadline: Date.now() + 5000, waitForReady: true }, (err: grpc.ServiceError | null, res: { metadata?: { id?: number }[] }) => {
          const id = res?.metadata?.[0]?.id;
          if (err || id === undefined) reject(new ProviderRejected(`${path}: ${err?.details ?? "not a signal of this databroker"}`));
          else resolve(id);
        }),
      ),
    open: () => client.OpenProviderStream() as ProviderStream,
    close: () => client.close(),
  };
}
