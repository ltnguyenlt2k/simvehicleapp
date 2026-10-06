import { expect, test } from "bun:test";
import { CatalogUnavailableError, catalogModelHash, catalogVehicleLookup } from "./vehicle-lookup.ts";

test("batches paths, maps unknown paths and unknown releases to null", async () => {
  const urls: string[] = [];
  const lookup = catalogVehicleLookup({
    baseUrl: "http://cat:4010/",
    secret: "s",
    requestId: () => "rid",
    fetch: async (url, init) => {
      urls.push(url);
      expect((init?.headers as Record<string, string>)["x-sv-internal"]).toBe("s");
      const u = new URL(url);
      if (u.searchParams.get("release") === "v9.9") return new Response("{}", { status: 404 });
      const paths = u.searchParams.get("paths")!.split(",");
      return Response.json({ release: "v4.0", nodes: paths.filter((p) => p !== "Vehicle.X").map((p) => ({ path: p, name: p, kind: "sensor" })), unknown: paths.includes("Vehicle.X") ? ["Vehicle.X"] : undefined });
    },
  });
  const many = Array.from({ length: 2500 }, (_, i) => `Vehicle.S${i}`);
  const r = await lookup("v4.0", [...many, "Vehicle.X"]);
  expect(urls).toHaveLength(2);
  expect(urls[0]).toStartWith("http://cat:4010/nodes?");
  expect(r.get("Vehicle.S0")?.kind).toBe("sensor");
  expect(r.get("Vehicle.X")).toBeNull();
  expect((await lookup("v9.9", ["Vehicle.Speed"])).get("Vehicle.Speed")).toBeNull();
});

test("network errors and 5xx become CatalogUnavailableError", async () => {
  const down = catalogVehicleLookup({ baseUrl: "http://cat", secret: "s", fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
  await expect(down("v4.0", ["Vehicle.Speed"])).rejects.toBeInstanceOf(CatalogUnavailableError);
  const broken = catalogVehicleLookup({ baseUrl: "http://cat", secret: "s", fetch: async () => new Response("", { status: 503 }) });
  await expect(broken("v4.0", ["Vehicle.Speed"])).rejects.toThrow("HTTP 503");
});

test("model hash: 200 → hash, 404 → null, 5xx/network → CatalogUnavailableError", async () => {
  const hash = `sha256:${"c".repeat(64)}`;
  const urls: string[] = [];
  const lookup = catalogModelHash({
    baseUrl: "http://cat:4010/",
    secret: "s",
    fetch: async (url, init) => {
      urls.push(url);
      expect((init?.headers as Record<string, string>)["x-sv-internal"]).toBe("s");
      return new URL(url).searchParams.get("release") === "v4.0" ? Response.json({ release: "v4.0", modelHash: hash }) : new Response("{}", { status: 404 });
    },
  });
  expect(await lookup("v4.0")).toBe(hash);
  expect(urls[0]).toBe("http://cat:4010/model-hash?release=v4.0");
  expect(await lookup("v9.9")).toBeNull();
  const down = catalogModelHash({ baseUrl: "http://cat", secret: "s", fetch: () => Promise.reject(new Error("ECONNREFUSED")) });
  await expect(down("v4.0")).rejects.toBeInstanceOf(CatalogUnavailableError);
  const broken = catalogModelHash({ baseUrl: "http://cat", secret: "s", fetch: async () => new Response("", { status: 500 }) });
  await expect(broken("v4.0")).rejects.toThrow("HTTP 500");
});
