import { createLogger, createService, internalHeaders, Metrics } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createGatewayHandler, playerSet } from "./app.ts";
import { type Broker, grpcBroker } from "./broker.ts";
import { Catalog } from "./catalog.ts";
import { mqttPublisher, mqttSubscriber } from "./mqtt.ts";
import { Player } from "./player.ts";
import { grpcProviderApi, type ProviderApi } from "./provider.ts";
import { Sources } from "./sources.ts";

const port = Number(process.env.SV_SIGNAL_GATEWAY_PORT ?? 4050);
const log = createLogger({ service: "signal-gateway" });
const secret = process.env.INTERNAL_API_SECRET ?? "";
if (!secret) log.warn("INTERNAL_API_SECRET is not set: every signal-gateway request will be rejected (fail closed)");

// v4.0=databroker:55555,v4.2=databroker-v4-2:55555 (ADR-0024 §6): one databroker per VSS release.
const endpoints = new Map(
  (process.env.SV_DATABROKERS ?? "v4.0=databroker:55555")
    .split(",")
    .map((x) => x.trim().split("=", 2))
    .filter((kv): kv is [string, string] => kv.length === 2 && Boolean(kv[0]) && Boolean(kv[1])),
);
const brokers = new Map<string, Broker>();
// A run's sandbox (ADR-0057): its own databroker, `toolchain-<lang>:<port>`, keyed by address and closed when the run ends.
const broker = (release: string, sandbox?: string) => {
  const address = sandbox ?? endpoints.get(release);
  if (!address) return undefined;
  const key = sandbox ?? release;
  let b = brokers.get(key);
  if (!b) brokers.set(key, (b = grpcBroker(address)));
  return b;
};
const providerApis = new Map<string, ProviderApi>();
const providerApi = (release: string, sandbox?: string) => {
  const address = sandbox ?? endpoints.get(release);
  if (!address) return undefined;
  const key = sandbox ?? release;
  let p = providerApis.get(key);
  if (!p) providerApis.set(key, (p = grpcProviderApi(address)));
  return p;
};
const forget = (sandbox: string) => {
  brokers.get(sandbox)?.close();
  brokers.delete(sandbox);
  providerApis.get(sandbox)?.close();
  providerApis.delete(sandbox);
};
const catalogUrl = process.env.SV_CATALOG_URL ?? "http://vss-catalog:4010";
const catalog = new Catalog(async (release) => {
  const res = await fetch(`${catalogUrl}/vss?release=${encodeURIComponent(release)}`, { headers: internalHeaders(undefined, secret) });
  if (!res.ok) throw new Error(`vss-catalog /vss ⇒ ${res.status}`);
  return res.json();
});
const publish = mqttPublisher(process.env.SDV_MQTT_ADDRESS ?? "mqtt://mqtt:1883");
const subscribe = mqttSubscriber(process.env.SDV_MQTT_ADDRESS ?? "mqtt://mqtt:1883");
const playerIo = { publish, sleep: (ms: number) => Bun.sleep(ms), now: Date.now, monotonic: () => performance.now() };
const sources = new Sources();
const player = new Player({ ...playerIo, set: playerSet(broker, catalog, (release, path, field, value) => sources.mark(release, path, field, value, "playback")) });
const sandboxPlayer = (sandbox: string) =>
  new Player({ ...playerIo, set: playerSet((release) => broker(release, sandbox), catalog, (_release, path, field, value) => sources.mark(sandbox, path, field, value, "playback")) });

const handler = createService({ name: "signal-gateway", version: pkg.version, logger: log, metrics: new Metrics() }, createGatewayHandler({ broker, forget, providerApi, subscribe, catalog, player, sandboxPlayer, sources, newId: () => `play_${crypto.randomUUID()}` }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port, databrokers: Object.fromEntries(endpoints) });
