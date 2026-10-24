/** Spike client: calls through the proxy — a read, a stream, a refused write. */
import * as grpc from "@grpc/grpc-js";
import * as loader from "@grpc/proto-loader";

const proto = process.env.PROTO ?? "/m/services/signal-gateway/proto/kuksa/val/v2/val.proto";
const def = loader.loadSync(proto, { includeDirs: ["/m/services/signal-gateway/proto"], keepCase: false, longs: String, defaults: true, oneofs: true });
const pkg = grpc.loadPackageDefinition(def) as unknown as { kuksa: { val: { v2: { VAL: grpc.ServiceClientConstructor } } } };
const addr = process.argv[2] ?? "127.0.0.1:55560";
const c = new pkg.kuksa.val.v2.VAL(addr, grpc.credentials.createInsecure()) as unknown as Record<string, Function>;
const call = (m: string, req: unknown) => new Promise((res) => c[m](req, (err: grpc.ServiceError | null, r: unknown) => res(err ? { code: err.code, details: err.details } : r)));

console.log("GetServerInfo", JSON.stringify(await call("getServerInfo", {})));
console.log("GetValue Speed", JSON.stringify(await call("getValue", { signalId: { path: "Vehicle.Speed" } })).slice(0, 200));
console.log("Actuate", JSON.stringify(await call("actuate", { signalId: { path: "Vehicle.Body.Lights.Hazard.IsSignaling" }, value: { bool: true } })));
// A server stream through the proxy: Subscribe Speed, then a write to Speed from outside shows up.
const sub = c.subscribe({ signalPaths: ["Vehicle.Speed"] }) as grpc.ClientReadableStream<unknown>;
let n = 0;
sub.on("data", (d) => { n++; console.log("stream update", JSON.stringify(d).slice(0, 160)); });
sub.on("error", (e) => console.log("stream error", (e as grpc.ServiceError).code));
await Bun.sleep(1500);
console.log(`stream updates: ${n}`);
sub.cancel();
await Bun.sleep(200);
process.exit(0);
