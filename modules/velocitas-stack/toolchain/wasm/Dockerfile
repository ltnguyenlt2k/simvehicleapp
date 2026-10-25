# syntax=docker/dockerfile:1.7
# SimVehicleApp toolchain-wasm (ADR-0061, M20-T06): WebAssembly vehicle apps in C++ and Rust
# ---------------------------------------------------------------------------
# wasi-sdk-34 (C++ → wasm32-wasip1, CMake toolchain file), rust with the wasm32-wasip1 target, wasm-tools (validate,
# strip) and sv-wasm-host (precompile, tests, runs — from the wasm-host image). Two seeds served by GET /templates:
# cpp-wasm (template wasm-app-cpp + the C++ runtime) and rust-wasm (template wasm-app-rust + the Rust runtime, every
# crate vendored, cargo offline). Tarballs are pinned by sha256 (M20-T01 spike).
# ---------------------------------------------------------------------------
FROM ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0@sha256:4fa9d98197fd7d144dccfba9473e83ea30b7eff3afb06e2acf558c588b8da1cc AS kuksa-databroker
FROM oven/bun:1.3.8-debian AS agent
WORKDIR /src/velocitas-stack/toolchain/agent
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY toolchain/agent/package.json toolchain/agent/bun.lock toolchain/agent/bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY toolchain/agent/src src

FROM rust:1.98.1-slim-bookworm AS toolchain
ARG CARGO_JOBS=2
ARG WASI_SDK_URL=https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz
ARG WASI_SDK_SHA256=b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4
ARG WASM_TOOLS_URL=https://github.com/bytecodealliance/wasm-tools/releases/download/v1.262.0/wasm-tools-1.262.0-x86_64-linux.tar.gz
ARG WASM_TOOLS_SHA256=655b8df67d54c3ef9b52fc237c4e94bbfbb5f5f43825245cb0940a7002a9ed65
RUN apt-get update && apt-get install -y --no-install-recommends cmake make git ca-certificates python3 tar curl nlohmann-json3-dev \
 && rm -rf /var/lib/apt/lists/* \
 && rustup target add wasm32-wasip1 && rustup component add rustfmt \
 && curl -fsSL -o /tmp/wasi-sdk.tgz "$WASI_SDK_URL" && echo "$WASI_SDK_SHA256  /tmp/wasi-sdk.tgz" | sha256sum -c - \
 && mkdir -p /opt/wasi-sdk && tar -xzf /tmp/wasi-sdk.tgz -C /opt/wasi-sdk --strip-components=1 && rm /tmp/wasi-sdk.tgz \
 && curl -fsSL -o /tmp/wasm-tools.tgz "$WASM_TOOLS_URL" && echo "$WASM_TOOLS_SHA256  /tmp/wasm-tools.tgz" | sha256sum -c - \
 && tar -xzf /tmp/wasm-tools.tgz -C /usr/local/bin --strip-components=1 --wildcards '*/wasm-tools' && rm /tmp/wasm-tools.tgz \
 && mkdir -p /opt/sv/include && cp -r /usr/include/nlohmann /opt/sv/include/ \
 && useradd -m -u 4000 -s /bin/bash vscode \
 && chown -R vscode:vscode /opt/sv
# Only the nlohmann headers enter a wasm compile (the host's /usr/include never does).
ENV WASI_SDK_PATH=/opt/wasi-sdk SV_JSON_INCLUDE=/opt/sv/include SV_TOOLCHAIN=wasm \
    SV_SEED_DIR_CPP=/opt/sv/seed/wasm-cpp SV_SEED_DIR_RUST=/opt/sv/seed/wasm-rust \
    CARGO_HOME=/home/vscode/.cargo CARGO_TARGET_DIR=/home/vscode/.sv-target \
    PATH=/usr/local/cargo/bin:$PATH
COPY --from=wasmhost /usr/local/bin/sv-wasm-host /usr/local/bin/sv-wasm-host
COPY --from=wasmhost /usr/share/doc/sv-wasm-host /usr/share/doc/sv-wasm-host
USER vscode
COPY --chown=vscode:vscode templates/wasm-app-cpp/ /opt/sv/seed/wasm-cpp/
COPY --from=codegencpp --chown=vscode:vscode /src/compiler-code-cpp/runtime /opt/sv/seed/wasm-cpp/app/src/simvehicleapp-runtime
COPY --chown=vscode:vscode templates/wasm-app-rust/ /opt/sv/seed/wasm-rust/
COPY --from=codegenrust --chown=vscode:vscode /src/compiler-code-rust/runtime /opt/sv/seed/wasm-rust/app/src/simvehicleapp-runtime
# Offline Rust: every dependency of the seed's lock vendored, cargo configured to use only the vendor dir.
WORKDIR /opt/sv/seed/wasm-rust/app
RUN mkdir -p ${CARGO_HOME} \
 && cargo vendor --locked --versioned-dirs /opt/sv/cargo-vendor > /dev/null \
 && printf '[source.crates-io]\nreplace-with = "vendored-sources"\n\n[source.vendored-sources]\ndirectory = "/opt/sv/cargo-vendor"\n\n[net]\noffline = true\n' > ${CARGO_HOME}/config.toml
# Prove both toolchains build a module here and warm the shared target dir: the runtimes with an app without
# workflows (a temporary copy of each seed; the seeds stay as shipped).
RUN set -eu; t=$(mktemp -d); cp -r /opt/sv/seed/wasm-rust/. "$t/"; mkdir -p "$t/app/src/generated"; \
    printf 'pub mod app {\n    pub const APP_NAME: &str = "Seed";\n    pub const TRACE_LEVEL: &str = "node";\n}\npub mod wasm {\n    pub fn app(on_app_start: fn(), on_app_stop: fn()) -> simvehicleapp_runtime::wasm::App {\n        simvehicleapp_runtime::wasm::App { name: super::app::APP_NAME, trace_level: super::app::TRACE_LEVEL, workflows: vec![], on_app_start, on_app_stop }\n    }\n}\n' > "$t/app/src/generated/mod.rs"; \
    cargo build --manifest-path "$t/app/Cargo.toml" --release --locked --offline --target wasm32-wasip1 -j ${CARGO_JOBS}; \
    wasm-tools validate "$CARGO_TARGET_DIR/wasm32-wasip1/release/app.wasm"; \
    t2=$(mktemp -d); cp -r /opt/sv/seed/wasm-cpp/. "$t2/"; mkdir -p "$t2/app/src/generated"; \
    printf 'set(SV_GENERATED_DIR ${CMAKE_CURRENT_LIST_DIR})\nset(SV_GENERATED_WORKFLOW_SOURCES)\nset(SV_GENERATED_SOURCES ${SV_GENERATED_DIR}/MainWasm.cpp)\n' > "$t2/app/src/generated/generated.cmake"; \
    printf '#include "simvehicleapp/rt/Wasm.hpp"\n#include "user/UserHooks.hpp"\nnamespace {\n[[maybe_unused]] const bool registered = simvehicleapp::rt::wasm::registerApp({"Seed", simvehicleapp::rt::TraceLevel::Node, {}, [] {}, [] {}});\n}\n' > "$t2/app/src/generated/MainWasm.cpp"; \
    cmake -S "$t2/app" -B "$t2/build" -DCMAKE_TOOLCHAIN_FILE="$WASI_SDK_PATH/share/cmake/wasi-sdk-p1.cmake" -DCMAKE_BUILD_TYPE=Release > /dev/null; \
    cmake --build "$t2/build" -j ${CARGO_JOBS}; wasm-tools validate "$t2/build/app.wasm"; \
    sv-wasm-host --precompile "$t2/build/app.wasm" "$t2/app.cwasm"; \
    rm -rf "$t" "$t2" "$CARGO_TARGET_DIR/wasm32-wasip1/release/app.wasm"
USER root
COPY toolchain/rust/sv-entrypoint.sh /usr/local/bin/sv-entrypoint
RUN chmod 0755 /usr/local/bin/sv-entrypoint
USER vscode
# Per-run vehicle sandboxes (ADR-0057): the KUKSA databroker binary, spawned by the agent next to each app.
COPY --from=kuksa-databroker /app/databroker /usr/local/bin/kuksa-databroker
COPY --from=kuksa-databroker /app/thirdparty-licenses /usr/share/licenses/kuksa-databroker/
COPY --from=kuksa-databroker /app/sbom.json /usr/share/licenses/kuksa-databroker/sbom.json
COPY --from=agent /usr/local/bin/bun /usr/local/bin/bun
COPY --from=agent /src /src
ENV SV_TOOLCHAIN_PORT=4240 SV_PROJECTS_DIR=/workspace/projects
WORKDIR /workspace
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4240/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["sv-entrypoint"]
CMD ["bun", "/src/velocitas-stack/toolchain/agent/src/main.ts"]
