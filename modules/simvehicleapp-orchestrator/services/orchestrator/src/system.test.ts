import { afterAll, describe, expect, test } from "bun:test";
import { httpClients } from "./clients.ts";

/** System status (ADR-0033 §4): health + version of every service the orchestrator drives. */
describe("clients.system()", () => {
  const up = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/healthz"
        ? Response.json({ status: "ok" })
        : Response.json({ name: "compiler", version: "0.4.0", commit: "abc", contracts: "1.0.0-alpha.1" }),
  });
  const degraded = Bun.serve({ port: 0, fetch: () => new Response("no", { status: 503 }) });
  afterAll(() => {
    up.stop(true);
    degraded.stop(true);
  });

  test("ok with version, degraded on 503, down when unreachable; every driven service listed", async () => {
    const c = httpClients({
      compiler: `http://127.0.0.1:${up.port}`,
      workspace: `http://127.0.0.1:${degraded.port}`,
      signalGateway: "http://127.0.0.1:1",
      backends: { cpp: `http://127.0.0.1:${up.port}` },
      toolchains: { cpp: "http://127.0.0.1:1" },
      secret: "s",
    });
    const s = await c.system();
    expect(s.map((x) => [x.service, x.status])).toEqual([
      ["compiler", "ok"],
      ["workspace", "degraded"],
      ["signal-gateway", "down"],
      ["codegen-cpp", "ok"],
      ["toolchain-cpp", "down"],
    ]);
    expect(s[0]).toMatchObject({ version: "0.4.0", commit: "abc", contracts: "1.0.0-alpha.1" });
  });
});
