#!/usr/bin/env bash
# Runtime conformance P1 of the Rust backend (ADR-0042, M13-T02/T04): generate every golden and conformance
# case into one crate, build it with the runtime in the pinned Rust image, run every case on the mock vehicle,
# check the results.
#   generator/conformance/conformance.sh [--only ID]
# env: SV_RUST_IMAGE (default rust:1.98.1-slim-bookworm), SV_CARGO (run cargo on the host instead of in the image).
# Cargo's home and the build stay in the module's build/ (owned by the caller; nothing root-owned is written).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
module=$(cd "$here/.." && pwd)
build=$module/build/conformance
cd "$here"
bun conformance/run.ts prepare --build-dir "$build" "$@"
rm -rf "$build/results" && mkdir -p "$build/results"
script='set -e; cd "$BUILD"; cargo build -q --release -j2; for d in cases/*/; do id=$(basename "$d"); run=sim; case "$id" in GW-*) run=golden;; esac; if ! target/release/sv-conformance "$id" "$d/scenario.json" "$run" > "results/$id.json" 2> "results/$id.err"; then rm -f "results/$id.json"; echo "$id failed: $(tail -3 results/$id.err)" >&2; fi; done'
if [ -n "${SV_CARGO:-}" ]; then
  BUILD="$build" bash -c "$script"
else
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e CARGO_HOME=/work/build/cargo -e BUILD=/work/build/conformance \
    -v "$module":/work -w /work "${SV_RUST_IMAGE:-rust:1.98.1-slim-bookworm}" bash -c "$script"
fi
bun conformance/run.ts check --build-dir "$build" "$@"
