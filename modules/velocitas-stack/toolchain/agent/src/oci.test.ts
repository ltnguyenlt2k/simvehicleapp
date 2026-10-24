import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImage, type ImageFile, parseReference, pushImage, sha256, tar } from "./oci.ts";

const enc = new TextEncoder();
const files: ImageFile[] = [
  { path: "app", data: enc.encode("#!binary"), mode: 0o755 },
  { path: "lib/x86_64-linux-gnu/libc.so.6", data: enc.encode("libc"), mode: 0o644 },
  { path: "AppManifest.json", data: enc.encode("{}"), mode: 0o644 },
];
const cfg = { cmd: ["/app"], env: ["PATH=/"], workingDir: "/tmp" };

describe("OCI image without a daemon (M18-T10, ADR-0060)", () => {
  test("the layer is a tar the system tar reads, with parent directories and modes", () => {
    const dir = mkdtempSync(join(tmpdir(), "oci-"));
    writeFileSync(join(dir, "layer.tar"), tar(files));
    const list = Bun.spawnSync(["tar", "-tvf", join(dir, "layer.tar")]).stdout.toString();
    expect(list).toContain("-rwxr-xr-x");
    expect(list.split("\n").map((l) => l.split(/\s+/).pop()).filter(Boolean)).toEqual(["AppManifest.json", "app", "lib/", "lib/x86_64-linux-gnu/", "lib/x86_64-linux-gnu/libc.so.6"]);
    // a long path goes to the ustar prefix
    const long = `${"d".repeat(80)}/${"e".repeat(60)}/file`;
    writeFileSync(join(dir, "long.tar"), tar([{ path: long, data: enc.encode("x"), mode: 0o644 }]));
    expect(Bun.spawnSync(["tar", "-tf", join(dir, "long.tar")]).stdout.toString()).toContain(long);
  });

  test("the same files give the same digests; config and manifest point at each other", () => {
    const a = buildImage(files, cfg);
    const b = buildImage([...files].reverse(), cfg);
    expect(b.digests).toEqual(a.digests);
    const manifest = JSON.parse(new TextDecoder().decode(a.manifest));
    expect(manifest.config.digest).toBe(sha256(a.config));
    expect(manifest.layers[0].digest).toBe(sha256(a.layer));
    expect(JSON.parse(new TextDecoder().decode(a.config))).toMatchObject({ os: "linux", config: { Cmd: ["/app"], WorkingDir: "/tmp" } });
  });

  test("references", () => {
    expect(parseReference("registry:5000/vehicle/hazard:1.2")).toEqual({ registry: "registry:5000", repository: "vehicle/hazard", tag: "1.2" });
    expect(parseReference("ghcr.io/acme/app")).toMatchObject({ tag: "latest" });
    expect(() => parseReference("app:1")).toThrow("not an image reference");
  });

  test("push: blobs then manifest to a registry; a blob it has is not sent again; credentials as basic auth", async () => {
    const blobs = new Map<string, Uint8Array>();
    const manifests = new Map<string, string>();
    const auths: (string | null)[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        auths.push(req.headers.get("authorization"));
        const blob = /^\/v2\/(.+)\/blobs\/(sha256:[0-9a-f]+)$/.exec(url.pathname);
        if (blob && req.method === "HEAD") return new Response(null, { status: blobs.has(blob[2]!) ? 200 : 404 });
        if (/\/blobs\/uploads\/$/.test(url.pathname) && req.method === "POST") return new Response(null, { status: 202, headers: { location: `${url.pathname}u1?state=x` } });
        if (/\/blobs\/uploads\/u1$/.test(url.pathname) && req.method === "PUT") {
          const data = new Uint8Array(await req.arrayBuffer());
          const digest = url.searchParams.get("digest")!;
          if (sha256(data) !== digest) return new Response("digest mismatch", { status: 400 });
          blobs.set(digest, data);
          return new Response(null, { status: 201 });
        }
        const m = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(url.pathname);
        if (m && req.method === "PUT") {
          const body = await req.text();
          manifests.set(`${m[1]}:${m[2]}`, body);
          return new Response(null, { status: 201, headers: { "docker-content-digest": sha256(enc.encode(body)) } });
        }
        return new Response("no", { status: 404 });
      },
    });
    try {
      const img = buildImage(files, cfg);
      const lines: string[] = [];
      const digest = await pushImage(`127.0.0.1:${server.port}/vehicle/hazard:1`, img, { insecure: true, username: "u", password: "p", log: (l) => lines.push(l) });
      expect(digest).toBe(img.digests.manifest);
      expect([...blobs.keys()].sort()).toEqual([img.digests.config, img.digests.layer].sort());
      expect(manifests.has("vehicle/hazard:1")).toBe(true);
      expect(auths.every((a) => a === `Basic ${Buffer.from("u:p").toString("base64")}`)).toBe(true);
      await pushImage(`127.0.0.1:${server.port}/vehicle/hazard:2`, img, { insecure: true, log: (l) => lines.push(l) });
      expect(lines.filter((l) => l.includes("already there"))).toHaveLength(2);
    } finally {
      server.stop(true);
    }
  });
});

describe("image-cli", () => {
  test("ldd output ⇒ the libraries and the loader", async () => {
    const { lddLibraries } = await import("./image-cli.ts");
    const out = `\tlinux-vdso.so.1 (0x00007ffc)\n\tlibstdc++.so.6 => /lib/x86_64-linux-gnu/libstdc++.so.6 (0x0000712e)\n\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x0000712f)\n\t/lib64/ld-linux-x86-64.so.2 (0x0000712e5ded7000)\n`;
    expect(lddLibraries(out)).toEqual(["/lib/x86_64-linux-gnu/libc.so.6", "/lib/x86_64-linux-gnu/libstdc++.so.6", "/lib64/ld-linux-x86-64.so.2"]);
  });
});
