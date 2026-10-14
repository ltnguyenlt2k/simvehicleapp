import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentHandler } from "./app.ts";
import { type CacheConfig, cacheDirOf, forget, gc } from "./cache.ts";

const SCRATCH = mkdtempSync(fileURLToPath(new URL("../.test-cache-", import.meta.url)));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));
const ctx = { log: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } } } as never;
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
let n = 0;

/** A toolchain home: the seed's cache with the shared venv, and project caches linking to it (ADR-0051). */
function home(): CacheConfig & { seedVenv: string } {
  const root = join(SCRATCH, `h${n++}`);
  const c = { home: join(root, "home"), projectsDir: join(root, "projects"), seedDir: join(root, "seed"), now: () => Date.now() + 3_600_000 };
  const seedVenv = join(c.home, ".velocitas/projects", md5(resolve(c.seedDir)), "pyvenv");
  mkdirSync(join(seedVenv, "bin"), { recursive: true });
  writeFileSync(join(seedVenv, "bin/python"), "x".repeat(1000));
  return { ...c, seedVenv };
}
function projectCache(c: CacheConfig & { seedVenv: string }, slug: string) {
  const dir = cacheDirOf(c, slug);
  mkdirSync(join(dir, "vehicle_model"), { recursive: true });
  writeFileSync(join(dir, "vehicle_model/Vehicle.hpp"), "y".repeat(500));
  symlinkSync(c.seedVenv, join(dir, "pyvenv"));
  return dir;
}

describe("project caches (ADR-0053)", () => {
  test("forget removes the project's cache and its venv link, never the shared venv; idempotent", () => {
    const c = home();
    const dir = projectCache(c, "app-a");
    expect(dir).toBe(join(c.home, ".velocitas/projects", md5(resolve(c.projectsDir, "app-a"))));
    expect(forget(c, "app-a")).toBe(true);
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(c.seedVenv, "bin/python"))).toBe(true);
    expect(forget(c, "app-a")).toBe(false);
  });

  test("gc keeps live projects, the seed and caches touched in the grace period; frees the rest", () => {
    const c = home();
    projectCache(c, "alive");
    const dead = projectCache(c, "dead");
    const fresh = projectCache(c, "being-created");
    mkdirSync(join(c.home, ".velocitas/projects/not-a-hash"), { recursive: true });
    const r = gc({ ...c, now: () => Date.now() + 3_600_000 }, ["alive"]);
    expect(r.removed).toBe(2);
    expect(r.freedBytes).toBeGreaterThanOrEqual(1000);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(cacheDirOf(c, "alive"))).toBe(true);
    expect(existsSync(join(c.seedVenv, "bin/python"))).toBe(true);
    expect(existsSync(join(c.home, ".velocitas/projects/not-a-hash"))).toBe(true);
    // grace: a cache touched just now survives even when not (yet) in keep
    const again = projectCache(c, "being-created-2");
    expect(gc({ ...c, now: () => Date.now() }, ["alive"]).removed).toBe(0);
    expect(existsSync(again)).toBe(true);
    void fresh;
    // an old one goes
    const old = projectCache(c, "old");
    utimesSync(old, new Date(0), new Date(0));
    expect(gc({ ...c, now: () => Date.now() }, ["alive", "being-created-2"]).removed).toBe(1);
  });

  test("a toolchain without Velocitas caches (Rust) answers gc with nothing removed", () => {
    expect(gc({ home: join(SCRATCH, "empty-home"), projectsDir: "/p" }, [])).toEqual({ removed: 0, freedBytes: 0 });
  });

  test("HTTP: forget 204 / 400, gc 200 / 400", async () => {
    const c = home();
    projectCache(c, "app-h");
    const h = createAgentHandler({ jobs: {} as never, template: () => null, cache: c });
    const post = (path: string, body?: unknown) => h(new Request(`http://tc${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), ctx);
    expect((await post("/projects/app-h/forget")).status).toBe(204);
    expect(existsSync(cacheDirOf(c, "app-h"))).toBe(false);
    expect((await post("/projects/Bad_Slug/forget")).status).toBe(400);
    const r = await post("/gc", { keep: [] });
    expect(r.status).toBe(200);
    expect(Object.keys(await r.json()).sort()).toEqual(["freedBytes", "removed"]);
    expect((await post("/gc", { keep: ["../x"] })).status).toBe(400);
    expect((await post("/gc", {})).status).toBe(400);
  });
});
