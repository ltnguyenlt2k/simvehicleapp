# syntax=docker/dockerfile:1.7
# SimVehicleApp toolchain-rust (ADR-0041, feasibility — not Velocitas tooling: Velocitas has no Rust template)
# ---------------------------------------------------------------------------
# rust (pinned) + cmake/g++ (kuksa-rust-sdk builds protoc from source) + rustfmt/clippy. The seed is the
# SimVehicleApp-owned template with the runtime crate (from the codegen-rust image); every crates.io
# dependency is vendored at build time and cargo runs offline; a warm shared target dir makes project
# builds reuse the dependency builds (the build job copies the app binary into the project).
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.8-debian AS agent
WORKDIR /src/velocitas-stack/toolchain/agent
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY toolchain/agent/package.json toolchain/agent/bun.lock toolchain/agent/bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY toolchain/agent/src src

FROM rust:1.98.1-slim-bookworm AS toolchain
ARG CARGO_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends cmake g++ make git ca-certificates python3 tar curl \
 && rm -rf /var/lib/apt/lists/* \
 && rustup component add rustfmt clippy \
 && useradd -m -u 4000 -s /bin/bash vscode \
 && mkdir -p /opt/sv && chown vscode:vscode /opt/sv
ARG SEED_DIR=/opt/sv/seed/rust
ENV SV_SEED_DIR=${SEED_DIR} SV_TOOLCHAIN=rust \
    CARGO_HOME=/home/vscode/.cargo CARGO_TARGET_DIR=/home/vscode/.sv-target \
    PATH=/usr/local/cargo/bin:$PATH
USER vscode
WORKDIR ${SEED_DIR}
COPY --chown=vscode:vscode templates/vehicle-app-rust-template/ ./
COPY --from=codegen --chown=vscode:vscode /src/compiler-code-rust/runtime ./app/src/simvehicleapp-runtime
COPY --chown=vscode:vscode vss/vss_rel_4.0.json /opt/sv/vss/vss_rel_4.0.json
COPY toolchain/cpp/sv-localize-vss.py /usr/local/bin/sv-localize-vss
RUN python3 /usr/local/bin/sv-localize-vss ${SEED_DIR} /opt/sv/vss/vss_rel_4.0.json
# Offline: every dependency vendored (the lock is the template's), cargo configured to use only the vendor dir.
RUN mkdir -p ${CARGO_HOME} \
 && cargo vendor --locked --versioned-dirs /opt/sv/cargo-vendor > /dev/null \
 && printf '[source.crates-io]\nreplace-with = "vendored-sources"\n\n[source.vendored-sources]\ndirectory = "/opt/sv/cargo-vendor"\n\n[net]\noffline = true\n' > ${CARGO_HOME}/config.toml
# Prove the seed builds offline and warm the shared target dir (dependency builds, protoc included).
RUN cargo build --release --locked -j ${CARGO_JOBS} && cargo test --release --locked -j ${CARGO_JOBS} --no-run \
 && cargo fmt --check && rm -rf ${CARGO_TARGET_DIR}/release/app
USER root
COPY toolchain/rust/sv-entrypoint.sh /usr/local/bin/sv-entrypoint
COPY toolchain/rust/sv-check-signals.py /usr/local/bin/sv-check-signals
COPY toolchain/cpp/sv-new-project.sh /usr/local/bin/sv-new-project
RUN chmod 0755 /usr/local/bin/sv-entrypoint /usr/local/bin/sv-check-signals /usr/local/bin/sv-new-project
USER vscode
COPY --from=agent /usr/local/bin/bun /usr/local/bin/bun
COPY --from=agent /src /src
ENV SV_TOOLCHAIN_PORT=4230 SV_PROJECTS_DIR=/workspace/projects
WORKDIR /workspace
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4230/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["sv-entrypoint"]
CMD ["bun", "/src/velocitas-stack/toolchain/agent/src/main.ts"]
