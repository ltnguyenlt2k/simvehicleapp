import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Raw files of one release as read from a source. `units`/`quantities` are optional per release (ADR-0010 Notes 2026-10-04). */
export interface ReleaseFiles {
  release: string;
  /** Decoded `vss_rel_<x.y>.json` document. */
  document: unknown;
  /** sha256 (hex) of the JSON file bytes. */
  sha256: string;
  units?: string;
  quantities?: string;
  /** Where the files came from (`file:<path>` or `https://…`), for logs and `/releases`. */
  origin: string;
}

/** ADR-0010 §2. */
export interface VehicleModelSource {
  readonly name: string;
  releases(): Promise<string[]>;
  /** `undefined` when this source does not know `release`. */
  load(release: string): Promise<ReleaseFiles | undefined>;
}

export class VssSourceError extends Error {
  constructor(
    readonly release: string,
    message: string,
  ) {
    super(`${release}: ${message}`);
    this.name = "VssSourceError";
  }
}

const RELEASE = /^v([0-9]+)\.([0-9]+)$/;

/** Sorts `v4.0 < v4.2 < v10.0`; throws on a malformed release name. */
export function compareReleases(a: string, b: string): number {
  const pa = RELEASE.exec(a);
  const pb = RELEASE.exec(b);
  if (!pa || !pb) throw new TypeError(`invalid release name: ${pa ? b : a}`);
  return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]);
}

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

const decodeJson = (release: string, bytes: Uint8Array, origin: string): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (e) {
    throw new VssSourceError(release, `${origin} is not valid UTF-8 JSON (${(e as Error).message})`);
  }
};

async function readOptional(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

export interface LocalReleaseEntry {
  release: string;
  json: string;
  units?: string;
  quantities?: string;
}

/**
 * Release files seeded on local disk (image seed or test fixtures). Missing optional files are
 * skipped; a missing JSON file is an error because the entry was declared explicitly.
 */
export class LocalFileSource implements VehicleModelSource {
  readonly name = "local";
  private readonly entries: ReadonlyMap<string, LocalReleaseEntry>;

  constructor(entries: readonly LocalReleaseEntry[]) {
    const map = new Map<string, LocalReleaseEntry>();
    for (const e of entries) {
      if (!RELEASE.test(e.release)) throw new TypeError(`invalid release name: ${e.release}`);
      if (map.has(e.release)) throw new TypeError(`duplicate release: ${e.release}`);
      map.set(e.release, e);
    }
    this.entries = map;
  }

  /**
   * Directory layout `<dir>/<vX.Y>/vss_rel_<X.Y>.json` (+ optional `units.yaml`, `quantities.yaml`).
   * Subdirectories that do not match the layout are ignored.
   */
  static async fromDirectory(dir: string): Promise<LocalFileSource> {
    const entries: LocalReleaseEntry[] = [];
    for (const d of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && RELEASE.test(d.name))) {
      const base = join(dir, d.name);
      const json = join(base, `vss_rel_${d.name.slice(1)}.json`);
      const files = new Set(await readdir(base));
      if (!files.has(`vss_rel_${d.name.slice(1)}.json`)) continue;
      entries.push({
        release: d.name,
        json,
        units: files.has("units.yaml") ? join(base, "units.yaml") : undefined,
        quantities: files.has("quantities.yaml") ? join(base, "quantities.yaml") : undefined,
      });
    }
    return new LocalFileSource(entries);
  }

  async releases(): Promise<string[]> {
    return [...this.entries.keys()].sort(compareReleases);
  }

  async load(release: string): Promise<ReleaseFiles | undefined> {
    const e = this.entries.get(release);
    if (!e) return undefined;
    const bytes = new Uint8Array(await readFile(e.json));
    return {
      release,
      document: decodeJson(release, bytes, e.json),
      sha256: sha256(bytes),
      units: await readOptional(e.units),
      quantities: await readOptional(e.quantities),
      origin: `file:${e.json}`,
    };
  }
}

/** sha256 pins for one release tag. Only pinned releases are downloaded (supply-chain safety). */
export interface ReleasePin {
  json: string;
  units?: string;
  quantities?: string;
}

export interface HttpSourceOptions {
  /** Release pins by tag, e.g. `{ "v4.2": { json: "6de4…" } }`. */
  pins: Readonly<Record<string, ReleasePin>>;
  /** Cache directory (compose volume `sv-vss`). */
  cacheDir: string;
  /** Defaults to the COVESA GitHub release download URL. */
  baseUrl?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

export const COVESA_RELEASES_URL = "https://github.com/COVESA/vehicle_signal_specification/releases/download";

type FileKind = keyof ReleasePin;
const fileName = (release: string, kind: FileKind) => (kind === "json" ? `vss_rel_${release.slice(1)}.json` : `${kind}.yaml`);

/**
 * Downloads pinned COVESA release assets once into `cacheDir/<release>/` and serves them from the
 * cache afterwards. Every file is checked against its sha256 pin, both after download and when read
 * back from the cache; a cached file with a wrong hash is discarded and downloaded again.
 */
export class HttpSource implements VehicleModelSource {
  readonly name = "http";
  private readonly baseUrl: string;
  private readonly fetch: NonNullable<HttpSourceOptions["fetch"]>;
  private readonly timeoutMs: number;
  private readonly inflight = new Map<string, Promise<ReleaseFiles>>();

  constructor(private readonly options: HttpSourceOptions) {
    for (const [release, pin] of Object.entries(options.pins)) {
      if (!RELEASE.test(release)) throw new TypeError(`invalid release name: ${release}`);
      for (const [kind, hash] of Object.entries(pin)) {
        if (!/^[0-9a-f]{64}$/.test(hash as string)) throw new TypeError(`${release}: ${kind} pin must be a sha256 hex digest`);
      }
    }
    this.baseUrl = (options.baseUrl ?? COVESA_RELEASES_URL).replace(/\/+$/, "");
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async releases(): Promise<string[]> {
    return Object.keys(this.options.pins).sort(compareReleases);
  }

  load(release: string): Promise<ReleaseFiles | undefined> {
    const pin = this.options.pins[release];
    if (!pin) return Promise.resolve(undefined);
    let p = this.inflight.get(release);
    if (!p) {
      p = this.loadPinned(release, pin).finally(() => this.inflight.delete(release));
      this.inflight.set(release, p);
    }
    return p;
  }

  private async loadPinned(release: string, pin: ReleasePin): Promise<ReleaseFiles> {
    const dir = join(this.options.cacheDir, release);
    const get = async (kind: FileKind): Promise<Uint8Array | undefined> => {
      const hash = pin[kind];
      return hash === undefined ? undefined : this.cachedOrDownload(release, dir, kind, hash);
    };
    const json = (await get("json"))!;
    const units = await get("units");
    const quantities = await get("quantities");
    const text = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
    return {
      release,
      document: decodeJson(release, json, this.url(release, "json")),
      sha256: pin.json,
      units: text(units),
      quantities: text(quantities),
      origin: this.url(release, "json"),
    };
  }

  private url(release: string, kind: FileKind): string {
    return `${this.baseUrl}/${release}/${fileName(release, kind)}`;
  }

  private async cachedOrDownload(release: string, dir: string, kind: FileKind, hash: string): Promise<Uint8Array> {
    const path = join(dir, fileName(release, kind));
    try {
      const cached = new Uint8Array(await readFile(path));
      if (sha256(cached) === hash) return cached;
      await rm(path, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }

    const url = this.url(release, kind);
    let res: Response;
    try {
      res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), redirect: "follow" });
    } catch (e) {
      throw new VssSourceError(release, `download of ${url} failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new VssSourceError(release, `download of ${url} failed: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const got = sha256(bytes);
    if (got !== hash) throw new VssSourceError(release, `${url} sha256 ${got} does not match pin ${hash}`);

    await mkdir(dir, { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
    return bytes;
  }
}

/** First source that knows a release wins; `releases()` is the sorted union. */
export class CompositeSource implements VehicleModelSource {
  readonly name: string;

  constructor(private readonly sources: readonly VehicleModelSource[]) {
    this.name = sources.map((s) => s.name).join("+");
  }

  async releases(): Promise<string[]> {
    const all = new Set((await Promise.all(this.sources.map((s) => s.releases()))).flat());
    return [...all].sort(compareReleases);
  }

  async load(release: string): Promise<ReleaseFiles | undefined> {
    for (const s of this.sources) {
      const files = await s.load(release);
      if (files) return files;
    }
    return undefined;
  }
}

/**
 * COVESA release assets verified on 2026-10-04 (contracts `fixtures/vss/PROVENANCE.md`). v4.0 ships no
 * `units.yaml`/`quantities.yaml` asset; its units seed comes from the local source only.
 */
export const COVESA_PINS: Readonly<Record<string, ReleasePin>> = {
  "v4.0": { json: "925d9e1b5bd187694b3e03051a50777fdd5b46a5a5c4f48fd49ca270a07cdc50" },
  "v4.2": {
    json: "6de4edc9826b584c8459487ff1dc47ed3d57b3ddb31ebac4a1c4c2c170e870e3",
    units: "fd56ea3873ce8bc949f2d1e45959ffffa6a0cb06be0d2a70e004178492b301c7",
    quantities: "312d46692f9839bc7d1843fa77338379a894e63c1840406709bdbf7de1d4b04f",
  },
};
