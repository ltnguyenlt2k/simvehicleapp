import { afterEach, describe, expect, test } from "bun:test";
import { httpClients, isConnectionReset, ServiceUnavailable } from "./clients.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** fetch that fails the first `fails` calls with `err`, then answers 200 `{}`; records the URLs. */
function scripted(fails: number, err: Error) {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    if (urls.length <= fails) throw err;
    return Response.json({ release: "v4.0", path: null, changed: false });
  }) as typeof fetch;
  return urls;
}
const reset = Object.assign(new Error("The socket connection was closed unexpectedly. For more information, pass `verbose: true`"), { code: "ECONNRESET" });
const clients = httpClients({ compiler: "http://compiler", workspace: "http://workspace", backends: {}, toolchains: { cpp: "http://toolchain" }, secret: "s" });

describe("dead keep-alive connections (a restarted service)", () => {
  test("an idempotent call is sent once more after a reset, then succeeds", async () => {
    const urls = scripted(1, reset);
    expect(await clients.syncVss("p")).toEqual({ ok: true, value: { release: "v4.0", path: null, changed: false } });
    expect(urls).toEqual(["http://workspace/projects/p/vss-sync", "http://workspace/projects/p/vss-sync"]);
  });

  test("only once; a refused connection or a toolchain job is not retried", async () => {
    let urls = scripted(2, reset);
    await expect(clients.createProject({ slug: "p", language: "cpp", appName: "P", vssRelease: "v4.0" })).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(urls.length).toBe(2);
    urls = scripted(1, Object.assign(new Error("Unable to connect"), { code: "ConnectionRefused" }));
    await expect(clients.syncVss("p")).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(urls.length).toBe(1);
    urls = scripted(1, reset);
    await expect(clients.startJob("cpp", "build", "p")).rejects.toBeInstanceOf(ServiceUnavailable);
    expect(urls.length).toBe(1);
  });

  test("reset detection", () => {
    expect(isConnectionReset(reset)).toBe(true);
    expect(isConnectionReset(Object.assign(new Error("x"), { cause: { code: "UND_ERR_SOCKET" } }))).toBe(true);
    expect(isConnectionReset(new Error("The operation timed out."))).toBe(false);
    expect(isConnectionReset(null)).toBe(false);
  });
});
