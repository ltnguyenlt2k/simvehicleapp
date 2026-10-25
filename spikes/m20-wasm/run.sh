#!/usr/bin/env bash
# M20-T01 spike: build the C++ guest (wasi-sdk-34) and the Rust guest (wasm32-wasip1), a Wasmtime v48 C-API host,
# run both guests from .wasm and from precompiled .cwasm, and try the current C++ runtime with wasi-sdk.
# Everything runs in containers (pinned images and sha256-checked tarballs); output in out/, downloads in .cache/.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
mkdir -p "$here/.cache" "$here/out"

# Rust guest
docker run --rm --memory 3g --user "$(id -u):$(id -g)" -e HOME=/tmp -e CARGO_HOME=/work/.cache/cargo \
  -v "$here":/work -w /work/guest-rust rust:1.98.1-slim-bookworm bash -c '
    set -e; rustup target add wasm32-wasip1 >/dev/null 2>&1 || true
    cargo build -q --release --target wasm32-wasip1 --target-dir /work/.cache/rust-target
    cp /work/.cache/rust-target/wasm32-wasip1/release/sv_guest.wasm /work/out/guest-rust.wasm'

# Toolchain, C++ guest, host, runs
docker run --rm --memory 4g -v "$here":/work -v "$repo/modules/compiler-code-cpp":/cpp:ro -w /work debian:bookworm-slim bash -c '
set -euo pipefail
apt-get update -qq && apt-get install -y -qq curl ca-certificates xz-utils gcc libc6-dev >/dev/null
fetch() { # url sha256 file
  [ -f ".cache/$3" ] || curl -fsSL -o ".cache/$3" "$1"
  echo "$2  .cache/$3" | sha256sum -c --quiet
}
fetch https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz \
  b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4 wasi-sdk.tar.gz
fetch https://github.com/bytecodealliance/wasmtime/releases/download/v48.0.7/wasmtime-v48.0.7-x86_64-linux-c-api.tar.xz \
  3d65ab7a10127632ec6d41f0340866272abd9dab8bc7b9fdc9deaea811ee3719 wasmtime-c-api.tar.xz
fetch https://github.com/bytecodealliance/wasmtime/releases/download/v48.0.7/wasmtime-v48.0.7-x86_64-linux.tar.xz \
  2192e2b5b911dc42321b9eac2b7f1f0b0d03356058c1e2b2c2b892625bdd0f45 wasmtime-cli.tar.xz
fetch https://github.com/bytecodealliance/wasm-tools/releases/download/v1.262.0/wasm-tools-1.262.0-x86_64-linux.tar.gz \
  655b8df67d54c3ef9b52fc237c4e94bbfbb5f5f43825245cb0940a7002a9ed65 wasm-tools.tar.gz
mkdir -p /opt/sdk /opt/capi /opt/cli /opt/wt
tar -xzf .cache/wasi-sdk.tar.gz -C /opt/sdk --strip-components=1
tar -xJf .cache/wasmtime-c-api.tar.xz -C /opt/capi --strip-components=1
tar -xJf .cache/wasmtime-cli.tar.xz -C /opt/cli --strip-components=1
tar -xzf .cache/wasm-tools.tar.gz -C /opt/wt --strip-components=1
CXX=/opt/sdk/bin/clang++
echo "== versions"; $CXX --version | head -1; /opt/cli/wasmtime --version; /opt/wt/wasm-tools --version

echo "== C++ guest (reactor, -fno-exceptions, -Os)"
$CXX --target=wasm32-wasip1 -mexec-model=reactor -std=c++17 -Os -fno-exceptions -o out/guest-cpp.wasm guest-cpp/app.cpp
echo "== C++ guest with wasm exception handling (-fwasm-exceptions, new EH, libunwind)"
$CXX --target=wasm32-wasip1 -mexec-model=reactor -std=c++17 -Os -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false \
  -o out/guest-cpp-eh.wasm guest-cpp/eh.cpp -lunwind
for g in cpp cpp-eh rust; do
  /opt/wt/wasm-tools strip out/guest-$g.wasm -o out/guest-$g.strip.wasm
  /opt/wt/wasm-tools validate out/guest-$g.strip.wasm
done
ls -l out/*.wasm | awk "{print \$5, \$9}"

echo "== host (Wasmtime C API, static)"
gcc -O2 -o out/host host-c/host.c -I/opt/capi/include /opt/capi/lib/libwasmtime.a -lpthread -ldl -lm
ls -l out/host | awk "{print \$5, \$9}"
for g in cpp rust; do out/host --precompile out/guest-$g.strip.wasm out/guest-$g.cwasm; done
for f in out/guest-cpp.strip.wasm out/guest-cpp.cwasm out/guest-cpp-eh.strip.wasm out/guest-rust.strip.wasm out/guest-rust.cwasm; do
  out/host "$f" 2 | tail -3; SV_QUIET=1 out/host "$f" 10000 | tail -1
done

echo "== current C++ runtime with wasi-sdk (-fno-exceptions): errors by file"
JSON=$(ls -d /cpp/build/rt/_deps/nlohmann_json-src/single_include 2>/dev/null || true)
for s in /cpp/runtime/src/Runtime.cpp /cpp/runtime/src/Value.cpp /cpp/runtime/src/Strand.cpp /cpp/runtime/src/Testing.cpp; do
  n=$($CXX --target=wasm32-wasip1 -std=c++17 -fno-exceptions -I/cpp/runtime/include ${JSON:+-I$JSON} -c "$s" -o /tmp/x.o 2>&1 | grep -c "error:" || true)
  echo "$(basename "$s"): $n error(s)"
  $CXX --target=wasm32-wasip1 -std=c++17 -fno-exceptions -I/cpp/runtime/include ${JSON:+-I$JSON} -c "$s" -o /tmp/x.o 2>&1 | grep "error:" | sed -E "s/^[^ ]+ error: //" | sort | uniq -c | sort -rn | head -8
done
echo "== same with exceptions on (-fwasm-exceptions)"
for s in /cpp/runtime/src/Runtime.cpp /cpp/runtime/src/Strand.cpp; do
  n=$($CXX --target=wasm32-wasip1 -std=c++17 -fwasm-exceptions -I/cpp/runtime/include ${JSON:+-I$JSON} -c "$s" -o /tmp/x.o 2>&1 | grep -c "error:" || true)
  echo "$(basename "$s"): $n error(s)"
  $CXX --target=wasm32-wasip1 -std=c++17 -fwasm-exceptions -I/cpp/runtime/include ${JSON:+-I$JSON} -c "$s" -o /tmp/x.o 2>&1 | grep "error:" | sed -E "s/^[^ ]+ error: //" | sort | uniq -c | sort -rn | head -5
done
'
