import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COVESA_PINS,
  CompositeSource,
  compareReleases,
  HttpSource,
  LocalFileSource,
  parseVssRelease,
  VssSourceError,
} from "./index.ts";

const fixture = (rel: string) => fileURLToPath(import.meta.resolve(`@simvehicleapp/contracts/fixtures/vss/${rel}`));
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
/** Inside the module, not os.tmpdir(): the snap-packaged bun used locally cannot read /tmp. */
const TMP = join(import.meta.dir, "../.test-tmp");

const SEEDS = [
  { release: "v4.0", json: fixture("vss_rel_4.0.json"), units: fixture("units.yaml") },
  { release: "v4.2", json: fixture("vss_rel_4.2.json"), units: fixture("v4.2/units.yaml"), quantities: fixture("v4.2/quantities.yaml") },
];

afterAll(() => rm(TMP, { recursive: true, force: true }));

test("compareReleases orders numerically and rejects bad names", () => {
  expect(["v10.0", "v4.2", "v4.0", "v4.10"].sort(compareReleases)).toEqual(["v4.0", "v4.2", "v4.10", "v10.0"]);
  expect(() => compareReleases("4.0", "v4.0")).toThrow("invalid release name: 4.0");
});

test("COVESA_PINS match the vendored fixture bytes", async () => {
  expect(sha(await readFile(fixture("vss_rel_4.0.json")))).toBe(COVESA_PINS["v4.0"]!.json);
  expect(sha(await readFile(fixture("vss_rel_4.2.json")))).toBe(COVESA_PINS["v4.2"]!.json);
  expect(sha(await readFile(fixture("v4.2/units.yaml")))).toBe(COVESA_PINS["v4.2"]!.units!);
  expect(sha(await readFile(fixture("v4.2/quantities.yaml")))).toBe(COVESA_PINS["v4.2"]!.quantities!);
});

describe("LocalFileSource (seed v4.0, v4.2)", () => {
  const local = new LocalFileSource(SEEDS);

  test("lists and loads seeded releases offline", async () => {
    expect(await local.releases()).toEqual(["v4.0", "v4.2"]);
    const v40 = (await local.load("v4.0"))!;
    expect(v40.sha256).toBe(COVESA_PINS["v4.0"]!.json);
    expect(v40.units).toContain("km/h");
    expect(v40.quantities).toBeUndefined();
    expect(parseVssRelease(v40.document, v40.release).counts.branch).toBe(287);
    const v42 = (await local.load("v4.2"))!;
    expect(v42.quantities).toBeString();
    expect(v42.origin).toBe(`file:${fixture("vss_rel_4.2.json")}`);
  });

  test("unknown release is undefined, bad config throws", async () => {
    expect(await local.load("v5.0")).toBeUndefined();
    expect(() => new LocalFileSource([SEEDS[0]!, SEEDS[0]!])).toThrow("duplicate release");
    expect(() => new LocalFileSource([{ release: "4.0", json: "x" }])).toThrow("invalid release name");
  });

  test("fromDirectory follows <dir>/<vX.Y>/vss_rel_X.Y.json and skips other entries", async () => {
    const dir = join(TMP, "seed");
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "v4.2"), { recursive: true });
    await mkdir(join(dir, "v9.9"), { recursive: true });
    await mkdir(join(dir, "notes"), { recursive: true });
    await copyFile(fixture("vss_rel_4.2.json"), join(dir, "v4.2", "vss_rel_4.2.json"));
    await copyFile(fixture("v4.2/units.yaml"), join(dir, "v4.2", "units.yaml"));
    const src = await LocalFileSource.fromDirectory(dir);
    expect(await src.releases()).toEqual(["v4.2"]);
    const files = (await src.load("v4.2"))!;
    expect(files.units).toBeString();
    expect(files.quantities).toBeUndefined();
  });

  test("invalid JSON is a VssSourceError naming the file", async () => {
    const dir = join(TMP, "broken");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "bad.json"), "{nope");
    const src = new LocalFileSource([{ release: "v4.0", json: join(dir, "bad.json") }]);
    await expect(src.load("v4.0")).rejects.toThrow(VssSourceError);
  });
});

describe("HttpSource (offline, injected fetch)", () => {
  const cacheDir = join(TMP, "sv-vss");
  let calls: string[] = [];
  let assets: Record<string, Uint8Array | number>;

  const fakeFetch = async (url: string) => {
    calls.push(url);
    const body = assets[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (typeof body === "number") return new Response("", { status: body });
    return new Response(new Blob([body as Uint8Array<ArrayBuffer>]));
  };
  const base = "https://example.invalid/releases";
  const source = (pins = COVESA_PINS) => new HttpSource({ pins, cacheDir, baseUrl: `${base}/`, fetch: fakeFetch });

  beforeEach(async () => {
    calls = [];
    await rm(cacheDir, { recursive: true, force: true });
    assets = {
      [`${base}/v4.2/vss_rel_4.2.json`]: new Uint8Array(await readFile(fixture("vss_rel_4.2.json"))),
      [`${base}/v4.2/units.yaml`]: new Uint8Array(await readFile(fixture("v4.2/units.yaml"))),
      [`${base}/v4.2/quantities.yaml`]: new Uint8Array(await readFile(fixture("v4.2/quantities.yaml"))),
    };
  });

  test("downloads pinned assets once, then serves them from the cache", async () => {
    const files = (await source().load("v4.2"))!;
    expect(calls).toHaveLength(3);
    expect(files.origin).toBe(`${base}/v4.2/vss_rel_4.2.json`);
    expect(parseVssRelease(files.document, "v4.2").counts.attribute).toBe(118);
    expect((await readdir(join(cacheDir, "v4.2"))).sort()).toEqual(["quantities.yaml", "units.yaml", "vss_rel_4.2.json"]);

    calls = [];
    const again = (await source().load("v4.2"))!;
    expect(calls).toEqual([]);
    expect(again.units).toBe(files.units!);
  });

  test("concurrent loads share one download", async () => {
    const s = source();
    await Promise.all([s.load("v4.2"), s.load("v4.2"), s.load("v4.2")]);
    expect(calls).toHaveLength(3);
  });

  test("hash mismatch rejects and leaves no cache file", async () => {
    assets[`${base}/v4.2/vss_rel_4.2.json`] = new TextEncoder().encode('{"Vehicle":{"type":"branch"}}');
    await expect(source().load("v4.2")).rejects.toThrow("does not match pin");
    await expect(readdir(join(cacheDir, "v4.2"))).rejects.toThrow();
  });

  test("a tampered cache file is replaced by a fresh download", async () => {
    await source().load("v4.2");
    await writeFile(join(cacheDir, "v4.2", "vss_rel_4.2.json"), "{}");
    calls = [];
    const files = (await source().load("v4.2"))!;
    expect(calls).toEqual([`${base}/v4.2/vss_rel_4.2.json`]);
    expect(sha(await readFile(join(cacheDir, "v4.2", "vss_rel_4.2.json")))).toBe(files.sha256);
  });

  test("HTTP errors and unpinned releases", async () => {
    assets[`${base}/v4.2/vss_rel_4.2.json`] = 503;
    await expect(source().load("v4.2")).rejects.toThrow("HTTP 503");
    expect(await source().load("v4.1")).toBeUndefined();
    expect(calls.filter((u) => u.includes("v4.1"))).toEqual([]);
    expect(() => source({ "v4.2": { json: "abc" } })).toThrow("sha256 hex digest");
  });

  test("network failures surface as VssSourceError", async () => {
    const s = new HttpSource({
      pins: COVESA_PINS,
      cacheDir,
      fetch: () => Promise.reject(new Error("getaddrinfo ENOTFOUND")),
    });
    await expect(s.load("v4.0")).rejects.toThrow("ENOTFOUND");
  });
});

test("CompositeSource prefers the first source and unions releases", async () => {
  const local = new LocalFileSource([SEEDS[0]!]);
  const http = new HttpSource({ pins: COVESA_PINS, cacheDir: join(TMP, "unused"), fetch: () => Promise.reject(new Error("offline")) });
  const all = new CompositeSource([local, http]);
  expect(all.name).toBe("local+http");
  expect(await all.releases()).toEqual(["v4.0", "v4.2"]);
  expect((await all.load("v4.0"))!.origin).toStartWith("file:");
  await expect(all.load("v4.2")).rejects.toThrow("offline");
  expect(await all.load("v3.1")).toBeUndefined();
});
