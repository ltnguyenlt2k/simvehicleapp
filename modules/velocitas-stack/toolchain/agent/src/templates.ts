import { existsSync } from "node:fs";

/**
 * `GET /templates?lang=cpp` (ADR-0025 §2, ADR-0026 §2): the seeded template (vendored template +
 * offline Velocitas state baked in the image) as a tar stream, without build outputs.
 */
export function templateTar(lang: string, seedDirs: Record<string, string | undefined> = { cpp: process.env.SV_SEED_DIR }): ReadableStream<Uint8Array> | null {
  const dir = seedDirs[lang];
  if (!dir || !existsSync(dir)) return null;
  const proc = Bun.spawn(
    ["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=@0", "-C", dir, "--exclude=./build", "--exclude=./build-*", "--exclude=./.git", "-cf", "-", "."],
    { stdout: "pipe", stderr: "ignore" },
  );
  return proc.stdout;
}
