import { createHash } from "node:crypto";

/**
 * An OCI image of a vehicle app without a Docker daemon (ADR-0060 Notes, M18-T10): one layer (a tar of the app's
 * root file system, gzip), a config, a manifest; pushed with the OCI distribution HTTP API (monolithic blob uploads,
 * PUT manifest). Deterministic: entries sorted, mtime 0, uid/gid 0 — the same files give the same digests.
 */

export interface ImageFile {
  /** Path in the image, without the leading slash (`app`, `lib/x86_64-linux-gnu/libc.so.6`). */
  path: string;
  data: Uint8Array;
  mode: number;
}

export interface ImageConfig {
  cmd: string[];
  env: string[];
  workingDir: string;
  labels?: Record<string, string>;
}

export interface BuiltImage {
  layer: Uint8Array;
  config: Uint8Array;
  manifest: Uint8Array;
  digests: { layer: string; config: string; manifest: string; diffId: string };
}

export const sha256 = (b: Uint8Array) => `sha256:${createHash("sha256").update(b).digest("hex")}`;
const enc = new TextEncoder();

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

/** One ustar header (512 bytes); long paths go to the prefix field. */
function header(name: string, size: number, mode: number, type: "0" | "5"): Uint8Array {
  const h = new Uint8Array(512);
  let prefix = "";
  let base = name;
  if (enc.encode(name).length > 100) {
    const cut = name.lastIndexOf("/", 154);
    if (cut <= 0 || enc.encode(name.slice(cut + 1)).length > 100) throw new Error(`path too long for the image: ${name}`);
    prefix = name.slice(0, cut);
    base = name.slice(cut + 1);
  }
  const put = (s: string, at: number, len: number) => h.set(enc.encode(s).subarray(0, len), at);
  put(base, 0, 100);
  put(octal(mode & 0o7777, 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  put(prefix, 345, 155);
  const sum = h.reduce((a, b) => a + b, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

/** A tar of the files and their parent directories, sorted. */
export function tar(files: ImageFile[]): Uint8Array<ArrayBuffer> {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(`${parts.slice(0, i).join("/")}/`);
  }
  const entries = [...[...dirs].map((d) => ({ path: d, dir: true as const })), ...files.map((f) => ({ ...f, dir: false as const }))].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const chunks: Uint8Array[] = [];
  for (const e of entries) {
    if (e.dir) chunks.push(header(e.path, 0, 0o755, "5"));
    else {
      chunks.push(header(e.path, e.data.length, e.mode, "0"));
      chunks.push(e.data);
      const pad = (512 - (e.data.length % 512)) % 512;
      if (pad) chunks.push(new Uint8Array(pad));
    }
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export function buildImage(files: ImageFile[], cfg: ImageConfig, arch = "amd64"): BuiltImage {
  const raw = tar(files);
  // gzip with mtime 0 (Bun's gzipSync writes no timestamp): deterministic layer digest.
  const layer = Bun.gzipSync(new Uint8Array(raw), { level: 9 });
  const diffId = sha256(raw);
  const config = enc.encode(
    JSON.stringify({
      architecture: arch,
      os: "linux",
      config: { Cmd: cfg.cmd, Env: cfg.env, WorkingDir: cfg.workingDir, ...(cfg.labels ? { Labels: cfg.labels } : {}) },
      rootfs: { type: "layers", diff_ids: [diffId] },
      history: [{ created_by: "simvehicleapp toolchain image (ADR-0060)" }],
    }),
  );
  const manifest = enc.encode(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: sha256(config), size: config.length },
      layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: sha256(layer), size: layer.length }],
    }),
  );
  return { layer, config, manifest, digests: { layer: sha256(layer), config: sha256(config), manifest: sha256(manifest), diffId } };
}

/** `host:port/name/space:tag` ⇒ its parts (tag `latest` when absent). */
export function parseReference(ref: string): { registry: string; repository: string; tag: string } {
  const m = /^([A-Za-z0-9.-]+(?::[0-9]{2,5})?)\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*)(?::([A-Za-z0-9_][A-Za-z0-9_.-]{0,127}))?$/.exec(ref);
  if (!m) throw new Error(`not an image reference (registry/repository[:tag]): ${ref}`);
  return { registry: m[1]!, repository: m[2]!, tag: m[3] ?? "latest" };
}

export interface PushOptions {
  /** http instead of https (a lab registry). */
  insecure?: boolean;
  username?: string;
  password?: string;
  log?: (line: string) => void;
}

/** Pushes the image; resolves with the manifest digest. Basic auth when credentials are given. */
export async function pushImage(ref: string, img: BuiltImage, o: PushOptions = {}): Promise<string> {
  const { registry, repository, tag } = parseReference(ref);
  const base = `${o.insecure ? "http" : "https"}://${registry}/v2/${repository}`;
  const auth: Record<string, string> = o.username ? { authorization: `Basic ${Buffer.from(`${o.username}:${o.password ?? ""}`).toString("base64")}` } : {};
  const blob = async (data: Uint8Array, digest: string) => {
    const head = await fetch(`${base}/blobs/${digest}`, { method: "HEAD", headers: auth });
    if (head.ok) return o.log?.(`blob ${digest.slice(0, 19)} already there`);
    const start = await fetch(`${base}/blobs/uploads/`, { method: "POST", headers: auth });
    if (start.status !== 202) throw new Error(`registry refused the upload of ${digest}: ${start.status} ${await start.text()}`);
    const location = new URL(start.headers.get("location") ?? "", `${base}/`);
    location.searchParams.set("digest", digest);
    const put = await fetch(location, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream" }, body: Buffer.from(data) });
    if (put.status !== 201) throw new Error(`registry refused blob ${digest}: ${put.status} ${await put.text()}`);
    o.log?.(`blob ${digest.slice(0, 19)} pushed (${data.length} bytes)`);
  };
  await blob(img.layer, img.digests.layer);
  await blob(img.config, img.digests.config);
  const res = await fetch(`${base}/manifests/${tag}`, {
    method: "PUT",
    headers: { ...auth, "content-type": "application/vnd.oci.image.manifest.v1+json" },
    body: Buffer.from(img.manifest),
  });
  if (res.status !== 201) throw new Error(`registry refused the manifest: ${res.status} ${await res.text()}`);
  return res.headers.get("docker-content-digest") ?? img.digests.manifest;
}
