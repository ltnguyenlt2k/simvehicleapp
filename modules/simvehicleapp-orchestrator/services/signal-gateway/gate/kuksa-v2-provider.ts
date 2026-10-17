/**
 * kuksa.val.v2 provider gate (ADR-0047 §2), run by `kuksa-v2-provider.sh` (gate/) on sv-internal: the real signal-gateway and
 * the v4.0 databroker (0.5.0, kuksa.val.v2 next to sdv.databroker.v1).
 */
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";

const G = process.env.SV_SIGNAL_GATEWAY_URL ?? "http://signal-gateway:4050";
const VDB = process.env.SV_DATABROKER ?? "databroker:55555";
const h = { "x-sv-internal": process.env.INTERNAL_API_SECRET ?? "", "content-type": "application/json" };
// A seat heater: an actuator no gate or demo workflow writes.
const PATH = "Vehicle.Cabin.Seat.Row1.DriverSide.Heating";

const must = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`ok ${msg}`);
};
const def = loader.loadSync("kuksa/val/v2/val.proto", { includeDirs: [new URL("../proto", import.meta.url).pathname], keepCase: true, longs: String, enums: String, defaults: false, oneofs: true });
const vdb = new (grpc.loadPackageDefinition(def) as any).kuksa.val.v2.VAL(VDB, grpc.credentials.createInsecure());
const call = (m: string, req: unknown) => new Promise<any>((res, rej) => vdb[m](req, (e: any, r: any) => (e ? rej(e) : res(r))));
const mirror = (paths: string[]) => fetch(`${G}/mirror`, { method: "PUT", headers: h, body: JSON.stringify({ release: "v4.0", paths, api: "kuksa.val.v2" }) });

try {
  const before = await call("Actuate", { signal_id: { path: PATH }, value: { int32: 5 } }).then(() => "ok", (e) => e.code);
  must(before === grpc.status.UNAVAILABLE, `Actuate without a provider ⇒ UNAVAILABLE (${before})`);
  must((await mirror([PATH])).status === 204, "the gateway provides the actuator (PUT /mirror api kuksa.val.v2)");
  must((await mirror([PATH])).status === 204, "providing the same actuators again keeps the claim");
  const t0 = Date.now();
  await call("Actuate", { signal_id: { path: PATH }, value: { int32: 7 } });
  let v: unknown;
  for (let i = 0; i < 40 && v !== 7; i++) {
    await Bun.sleep(25);
    v = (await call("GetValue", { signal_id: { path: PATH } })).data_point?.value?.int32;
  }
  must(v === 7, `Actuate 7 accepted and published as current in ${Date.now() - t0} ms`);
  // A second provider (another process) is refused while the gateway holds it.
  const other = vdb.OpenProviderStream();
  const refused = await new Promise<number | string>((res) => {
    other.on("error", (e: grpc.ServiceError) => res(e.code));
    other.on("data", () => res("accepted"));
    other.write({ provide_actuation_request: { actuator_identifiers: [{ path: PATH }] } });
  });
  other.cancel();
  must(refused === grpc.status.ALREADY_EXISTS, `a second provider is refused (${refused})`);
} finally {
  await mirror([]);
}
await Bun.sleep(200);
const after = await call("Actuate", { signal_id: { path: PATH }, value: { int32: 1 } }).then(() => "ok", (e) => e.code);
must(after === grpc.status.UNAVAILABLE, `released: Actuate is UNAVAILABLE again (${after})`);
process.exit(0);
