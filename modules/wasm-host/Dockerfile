# sv-wasm-host (ADR-0061, M20-T03): the host of SimVehicleApp WebAssembly apps. Built standalone from this module
# (docker build modules/wasm-host); toolchain-wasm and the deploy image of a WASM app copy the binary from it (M20-T06).
FROM rust:1.98.1-slim-bookworm AS build
ARG CARGO_BUILD_JOBS=2
# kuksa-rust-sdk builds protoc from source.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends cmake g++ make >/dev/null && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
RUN cargo build --locked --release -j "$CARGO_BUILD_JOBS" && cp target/release/sv-wasm-host /sv-wasm-host

FROM debian:bookworm-slim
COPY --from=build /sv-wasm-host /usr/local/bin/sv-wasm-host
COPY LICENSE NOTICE /usr/share/doc/sv-wasm-host/
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/sv-wasm-host"]
