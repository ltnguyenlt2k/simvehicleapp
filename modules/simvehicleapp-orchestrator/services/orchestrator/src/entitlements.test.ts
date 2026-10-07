import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson, type Decision, EntitlementService, type License, loadLicense } from "./entitlements.ts";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const signed = (doc: Omit<License, "signature">) => ({ ...doc, signature: sign(null, Buffer.from(canonicalJson(doc)), privateKey).toString("base64") });
const full = signed({ licenseVersion: "1.0.0", edition: "full", licensee: "ACME", features: {}, limits: {}, expiry: null });
const restricted = signed({ licenseVersion: "1.0.0", edition: "community", licensee: "Jane", features: { "export.source": false, "ai.assistant": false, languages: ["cpp"] }, limits: { maxProjects: 2 }, expiry: "2027-01-31" });

describe("EntitlementService (M09-T07, ADR-0031)", () => {
  test("canonical JSON sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"x":2,"y":1}]},"b":1}');
  });

  test("licenses are verified offline: schema, Ed25519 signature, key", () => {
    expect(loadLicense(JSON.stringify(full), pem)).toMatchObject({ ok: true });
    expect(loadLicense(Buffer.from(JSON.stringify(full)).toString("base64"), pem)).toMatchObject({ ok: true });
    expect(loadLicense(JSON.stringify({ ...full, edition: "enterprise" }), pem)).toEqual({ ok: false, reason: "the license signature is invalid" });
    expect(loadLicense(JSON.stringify({ ...full, extra: 1 }), pem)).toMatchObject({ ok: false, reason: expect.stringContaining("License v1") });
    expect(loadLicense("", pem)).toMatchObject({ ok: false });
    expect(loadLicense(JSON.stringify(full), undefined)).toMatchObject({ ok: false, reason: expect.stringContaining("public key") });
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(loadLicense(JSON.stringify(full), other)).toMatchObject({ ok: false, reason: "the license signature is invalid" });
  });

  test("enforce: a full license allows everything, a restricted one denies what it restricts", () => {
    const fullSvc = new EntitlementService("enforce", loadLicense(JSON.stringify(full), pem));
    for (const f of ["syncode", "export.source", "ide.access", "ai.assistant"] as const) expect(fullSvc.check(f, { language: "python" }).allowed).toBe(true);
    const svc = new EntitlementService("enforce", loadLicense(JSON.stringify(restricted), pem), () => {}, () => "2026-10-07");
    expect(svc.check("syncode", { language: "cpp" })).toMatchObject({ allowed: true, licensed: true });
    expect(svc.check("syncode", { language: "python" })).toMatchObject({ allowed: false, reason: expect.stringContaining("python") });
    expect(svc.check("export.source")).toMatchObject({ allowed: false, reason: "export.source is not part of the community license" });
    expect(svc.check("ai.assistant").allowed).toBe(false);
    expect(svc.check("ide.access").allowed).toBe(true); // not mentioned ⇒ allowed
    expect(svc.check("project.create", { language: "cpp", projectCount: 1 }).allowed).toBe(true);
    expect(svc.check("project.create", { language: "cpp", projectCount: 2 })).toMatchObject({ allowed: false, reason: "the license allows 2 project(s)" });
  });

  test("enforce: an expired or missing license denies; full mode allows but logs what the license says", () => {
    const expired = new EntitlementService("enforce", loadLicense(JSON.stringify(restricted), pem), () => {}, () => "2027-02-01");
    expect(expired.check("syncode", { language: "cpp" })).toMatchObject({ allowed: false, reason: "the license expired on 2027-01-31" });
    const none = new EntitlementService("enforce", loadLicense(undefined, pem));
    expect(none.check("syncode")).toMatchObject({ allowed: false, licensed: false });
    const logged: Decision[] = [];
    const mvp = new EntitlementService("full", loadLicense(JSON.stringify(restricted), pem), (d) => logged.push(d), () => "2026-10-07");
    expect(mvp.check("export.source")).toMatchObject({ allowed: true, licensed: false, mode: "full" });
    expect(logged).toEqual([expect.objectContaining({ feature: "export.source", allowed: true, licensed: false })]);
    expect(mvp.status).toMatchObject({ mode: "full", licensed: true, edition: "community" });
  });
});

describe("PDP on the orchestrator's actions (403 not_entitled)", () => {
  test("enforce: SynCode of a language outside the license, a project over the limit and the IDE link are denied", async () => {
    const { createOrchestratorHandler } = await import("./app.ts");
    const { EventHub } = await import("./events.ts");
    const { MemoryRepo } = await import("./repo.ts");
    const repo = new MemoryRepo();
    const license = signed({ licenseVersion: "1.0.0", edition: "community", licensee: "Jane", features: { languages: ["python"], "ide.access": false }, limits: { maxProjects: 1 }, expiry: null });
    const entitlements = new EntitlementService("enforce", loadLicense(JSON.stringify(license), pem));
    const clients = { createProject: async () => ({ ok: true, value: {} }), job: async () => ({ id: "j", state: "succeeded", exitCode: 0, diagnostics: [] }) } as never;
    const logs: [string, unknown][] = [];
    const ctx = { log: { info: (m: string, d: unknown) => logs.push([m, d]), warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
    const h = createOrchestratorHandler({ repo, clients, hub: new EventHub(), entitlements, ideUrl: "http://127.0.0.1:8080", kick() {}, background() {} });
    const call = (method: string, path: string, body?: unknown) => h(new Request(`http://o${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), ctx);
    const cpp = await call("POST", "/projects", { slug: "a", name: "A", language: "cpp", vssRelease: "v4.0" });
    expect(cpp.status).toBe(403);
    expect(await cpp.json()).toMatchObject({ error: "not_entitled", feature: "project.create", message: expect.stringContaining("cpp") });
    expect((await call("POST", "/projects", { slug: "b", name: "B", language: "python", vssRelease: "v4.0" })).status).toBe(201);
    expect((await call("POST", "/projects", { slug: "c", name: "C", language: "python", vssRelease: "v4.0" })).status).toBe(403);
    const p = (await repo.project("b"))!;
    await repo.updateProject(p.id, { status: "ready" });
    expect((await (await call("GET", `/projects/${p.id}`)).json()).editor).toBeUndefined();
    expect(await (await call("GET", "/entitlements")).json()).toMatchObject({ mode: "enforce", licensed: true, edition: "community" });
    expect(logs.filter(([m]) => m === "entitlement")).toHaveLength(3);
  });
});
