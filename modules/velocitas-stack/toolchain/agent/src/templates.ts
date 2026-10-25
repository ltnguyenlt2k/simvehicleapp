import { existsSync } from "node:fs";

/**
 * `GET /templates?lang=<SV_TOOLCHAIN>` (ADR-0025 §2, ADR-0026 §2): the seeded template (vendored template +
 * offline Velocitas state baked in the image) as a tar stream, without build outputs.
 */
/** Seeds by `lang`: the toolchain's own, or both WebAssembly seeds of toolchain-wasm (`cpp-wasm`, `rust-wasm`, ADR-0061). */
export function defaultSeeds(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  if (env.SV_TOOLCHAIN === "wasm") return { "cpp-wasm": env.SV_SEED_DIR_CPP, "rust-wasm": env.SV_SEED_DIR_RUST };
  return { [env.SV_TOOLCHAIN ?? "cpp"]: env.SV_SEED_DIR };
}

export function templateTar(lang: string, seedDirs: Record<string, string | undefined> = defaultSeeds()): ReadableStream<Uint8Array> | null {
  const dir = seedDirs[lang];
  if (!dir || !existsSync(dir)) return null;
  const proc = Bun.spawn(
    ["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "--mtime=@0", "-C", dir, "--exclude=./build", "--exclude=./build-*", "--exclude=./.git", "-cf", "-", "."],
    { stdout: "pipe", stderr: "ignore" },
  );
  return proc.stdout;
}
