import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";
import { type Datapoint, fromDatapoint, timestampMs } from "./values.ts";

/**
 * KUKSA databroker client over kuksa.val.v1 (ADR-0024 §4): current value and actuator target of
 * signals, inject (Set) and subscriptions. An interface so the HTTP layer is tested with a fake.
 */

export type Field = "value" | "target";

export interface BrokerUpdate {
  path: string;
  field: Field;
  value: unknown;
  ts: number;
}

export interface Broker {
  /** Current values (and targets of the given actuators); signals without a value are left out. */
  get(paths: string[], targets: string[]): Promise<BrokerUpdate[]>;
  /** Writes a value; throws BrokerRejected with the databroker's reason. */
  set(path: string, field: Field, datapoint: Datapoint): Promise<void>;
  /** Changes of `value` of `paths` and of `target` of `targets`; returns the cancel function. */
  subscribe(paths: string[], targets: string[], onUpdates: (u: BrokerUpdate[]) => void, onError: (e: Error) => void): () => void;
  close(): void;
}

export class BrokerRejected extends Error {}
export class BrokerUnavailable extends Error {}

const PROTO_DIR = fileURLToPath(new URL("../proto", import.meta.url));

type Entry = { path?: string; value?: Datapoint | null; actuator_target?: Datapoint | null };
type ApiError = { code?: number; reason?: string; message?: string } | null | undefined;

const FIELD = { value: "FIELD_VALUE", target: "FIELD_ACTUATOR_TARGET" } as const;

/** Updates of an entry; `changed` (a subscription's `fields`) limits them to what changed. */
function updatesOf(entry: Entry | undefined, now: number, changed?: string[]): BrokerUpdate[] {
  if (!entry?.path) return [];
  const out: BrokerUpdate[] = [];
  for (const [field, dp] of [["value", entry.value], ["target", entry.actuator_target]] as const) {
    if (changed && !changed.includes(FIELD[field])) continue;
    if (dp && typeof dp.value === "string") out.push({ path: entry.path, field, value: fromDatapoint(dp), ts: timestampMs(dp.timestamp as never) ?? now });
  }
  return out;
}

function errorText(error: ApiError, errors: { path?: string; error?: ApiError }[] | undefined): string | null {
  const first = errors?.find((e) => e.error && e.error.code && e.error.code !== 200);
  if (first) return `${first.path ?? ""}: ${first.error?.reason ?? ""} ${first.error?.message ?? ""}`.trim();
  if (error && error.code && error.code !== 200) return `${error.reason ?? ""} ${error.message ?? ""}`.trim();
  return null;
}

/** gRPC client of one databroker (`host:port`, insecure as in the dev stack, ADR-0024 §1). */
export function grpcBroker(address: string, now: () => number = Date.now): Broker {
  const def = loader.loadSync("kuksa/val/v1/val.proto", { includeDirs: [PROTO_DIR], keepCase: true, longs: String, enums: String, defaults: false, oneofs: true });
  const pkg = grpc.loadPackageDefinition(def) as any;
  const client = new pkg.kuksa.val.v1.VAL(address, grpc.credentials.createInsecure());
  const unary = <T>(method: string, req: unknown) =>
    new Promise<T>((resolve, reject) =>
      client[method](req, { deadline: Date.now() + 5000 }, (err: grpc.ServiceError | null, res: T) => {
        if (!err) return resolve(res);
        reject(err.code === grpc.status.UNAVAILABLE || err.code === grpc.status.DEADLINE_EXCEEDED ? new BrokerUnavailable(`databroker ${address}: ${err.details}`) : new BrokerRejected(err.details || err.message));
      }),
    );
  // One entry per path with every field wanted: the databroker keeps one entry per path, so a second
  // entry (value + target as two entries) silently drops the first (found by the M8 live E2E).
  const entries = (paths: string[], targets: string[]) =>
    [...new Set([...paths, ...targets])].map((path) => ({
      path,
      view: "VIEW_FIELDS",
      fields: [...(paths.includes(path) ? [FIELD.value] : []), ...(targets.includes(path) ? [FIELD.target] : [])],
    }));
  return {
    async get(paths, targets) {
      const res = await unary<{ entries?: Entry[]; error?: ApiError; errors?: { path?: string; error?: ApiError }[] }>("Get", { entries: entries(paths, targets) });
      const t = now();
      return (res.entries ?? []).flatMap((e) => updatesOf(e, t));
    },
    async set(path, field, datapoint) {
      const entry = field === "value" ? { path, value: datapoint } : { path, actuator_target: datapoint };
      const res = await unary<{ error?: ApiError; errors?: { path?: string; error?: ApiError }[] }>("Set", { updates: [{ entry, fields: [FIELD[field]] }] });
      const problem = errorText(res.error, res.errors);
      if (problem) throw new BrokerRejected(problem);
    },
    subscribe(paths, targets, onUpdates, onError) {
      const call = client.Subscribe({ entries: entries(paths, targets) });
      call.on("data", (res: { updates?: { entry?: Entry; fields?: string[] }[] }) => {
        const t = now();
        const updates = (res.updates ?? []).flatMap((u) => updatesOf(u.entry, t, u.fields?.length ? u.fields : undefined));
        if (updates.length) onUpdates(updates);
      });
      call.on("error", (err: grpc.ServiceError) => {
        if (err.code !== grpc.status.CANCELLED) onError(new BrokerUnavailable(err.details || err.message));
      });
      return () => call.cancel();
    },
    close() {
      client.close();
    },
  };
}
