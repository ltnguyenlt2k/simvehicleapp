import { expect, test } from "bun:test";
import { openToken, sealToken } from "./secrets.ts";

test("deploy target tokens: sealed with the internal secret, opened only with it (ADR-0060)", async () => {
  const sealed = await sealToken("tok-123", "secret-a");
  expect(sealed).toStartWith("v1.");
  expect(sealed).not.toContain("tok-123");
  expect(await openToken(sealed, "secret-a")).toBe("tok-123");
  expect(sealToken("tok-123", "secret-a")).resolves.not.toBe(sealed); // a fresh IV each time
  expect(openToken(sealed, "secret-b")).rejects.toThrow();
  expect(openToken("plain", "secret-a")).rejects.toThrow("not a sealed token");
});
