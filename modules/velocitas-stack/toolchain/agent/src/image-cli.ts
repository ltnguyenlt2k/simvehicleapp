/**
 * `bun src/image-cli.ts --binary <path> --project <dir> --reference <registry/repo:tag> [--insecure]` (ADR-0060,
 * M18-T10): the app's image without Docker — the binary as /app, the shared libraries `ldd` lists (and the loader),
 * the project's AppManifest and notices; pushed to the registry. Credentials: SV_IMAGE_USERNAME / SV_IMAGE_PASSWORD.
 * Prints one `SVIMAGE {"reference","digest","bytes","files"}` line at the end.
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildImage, type ImageFile, pushImage } from "./oci.ts";

export function lddLibraries(output: string): string[] {
  const out = new Set<string>();
  for (const line of output.split("\n")) {
    const arrow = /=>\s+(\/\S+)\s+\(/.exec(line);
    if (arrow) out.add(arrow[1]!);
    else {
      const loader = /^\s*(\/\S+)\s+\(0x/.exec(line);
      if (loader) out.add(loader[1]!);
    }
  }
  return [...out].sort();
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

if (import.meta.main) {
  const binary = arg("binary");
  const project = arg("project");
  const reference = arg("reference");
  if (!binary || !project || !reference) {
    console.error("usage: image-cli --binary <path> --project <dir> --reference <registry/repo:tag> [--insecure]");
    process.exit(2);
  }
  if (!existsSync(binary)) {
    console.error(`the app binary ${binary} was not built`);
    process.exit(1);
  }
  const ldd = Bun.spawnSync(["ldd", binary]);
  const text = ldd.stdout.toString();
  const statik = /not a dynamic executable|statically linked/.test(text + ldd.stderr.toString());
  const libs = statik ? [] : lddLibraries(text);
  const files: ImageFile[] = [{ path: "app", data: readFileSync(binary), mode: 0o755 }];
  for (const lib of libs) files.push({ path: lib.replace(/^\//, ""), data: readFileSync(realpathSync(lib)), mode: statSync(realpathSync(lib)).mode & 0o777 });
  for (const [from, to] of [
    ["app/AppManifest.json", "AppManifest.json"],
    ["NOTICE", "licenses/NOTICE"],
    ["THIRD-PARTY-NOTICES", "licenses/THIRD-PARTY-NOTICES"],
    ["LICENSE", "licenses/LICENSE"],
  ] as const) {
    const p = join(project, from);
    if (existsSync(p)) files.push({ path: to, data: readFileSync(p), mode: 0o644 });
  }
  console.log(`image: /app${statik ? " (static)" : ` with ${libs.length} shared libraries: ${libs.map((l) => l.split("/").pop()).join(", ")}`}`);
  const img = buildImage(files, {
    cmd: ["/app"],
    env: ["PATH=/", "LD_LIBRARY_PATH=/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu:/lib64"],
    workingDir: "/tmp",
    labels: { "org.opencontainers.image.source": "SimVehicleApp", "org.opencontainers.image.title": reference },
  });
  const bytes = img.layer.length + img.config.length + img.manifest.length;
  try {
    const digest = await pushImage(reference, img, {
      insecure: process.argv.includes("--insecure"),
      ...(process.env.SV_IMAGE_USERNAME ? { username: process.env.SV_IMAGE_USERNAME, password: process.env.SV_IMAGE_PASSWORD ?? "" } : {}),
      log: (l) => console.log(l),
    });
    console.log(`SVIMAGE ${JSON.stringify({ reference, digest, bytes, files: files.length })}`);
  } catch (e) {
    console.error(`push failed: ${(e as Error).message}`);
    process.exit(1);
  }
}
