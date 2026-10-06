import { createLogger, createService, internalHeaders } from "@simvehicleapp/service-kit";
import pkg from "../package.json" with { type: "json" };
import { createGatewayHandler, playerSet } from "./app.ts";
import { type Broker, grpcBroker } from "./broker.ts";
import { Catalog } from "./catalog.ts";
import { mqttPublisher } from "./mqtt.ts";
import { Player } from "./player.ts";

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
const broker = (release: string) => {
  const address = endpoints.get(release);
  if (!address) return undefined;
  let b = brokers.get(release);
  if (!b) brokers.set(release, (b = grpcBroker(address)));
  return b;
};
const catalogUrl = process.env.SV_CATALOG_URL ?? "http://vss-catalog:4010";
const catalog = new Catalog(async (release) => {
  const res = await fetch(`${catalogUrl}/vss?release=${encodeURIComponent(release)}`, { headers: internalHeaders(crypto.randomUUID(), secret) });
  if (!res.ok) throw new Error(`vss-catalog /vss ⇒ ${res.status}`);
  return res.json();
});
const publish = mqttPublisher(process.env.SDV_MQTT_ADDRESS ?? "mqtt://mqtt:1883");
const player = new Player({ set: playerSet(broker, catalog), publish, sleep: (ms) => Bun.sleep(ms), now: Date.now });

const handler = createService({ name: "signal-gateway", version: pkg.version, logger: log }, createGatewayHandler({ broker, catalog, player, newId: () => `play_${crypto.randomUUID()}` }));
const server = Bun.serve({ port, hostname: "0.0.0.0", fetch: handler, idleTimeout: 0 });
log.info("listening", { port: server.port, databrokers: Object.fromEntries(endpoints) });
