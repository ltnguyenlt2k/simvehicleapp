# syntax=docker/dockerfile:1.7
# SimVehicleApp toolchain-cpp
# ---------------------------------------------------------------------------
# Layer 1 ("devcontainer") is the vehicle-app-cpp-template's OWN .devcontainer image,
# built from templates/vehicle-app-cpp-template/.devcontainer exactly like VS Code
# Dev Containers would build it (see compose.yaml → service devcontainer-cpp).
# Layer 2 (this file) replays what .devcontainer/scripts/onCreateCommand.sh does
# (velocitas init/sync + setup-dependencies.sh + install_dependencies.sh) at IMAGE BUILD
# time, so containers start ready-to-build and can work offline (VELOCITAS_OFFLINE=1).
# ---------------------------------------------------------------------------
# Toolchain agent (ADR-0025 §2, toolchain.v1.yaml): Bun + sources + contracts at the same /src layout as the
# other services (contracts read their JSON Schemas from disk, so no single-file binary).
FROM oven/bun:1.3.8-debian AS agent
WORKDIR /src/velocitas-stack/toolchain/agent
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY toolchain/agent/package.json toolchain/agent/bun.lock toolchain/agent/bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY toolchain/agent/src src

FROM devcontainer AS toolchain

ARG CONAN_JOBS=8
ARG SEED_DIR=/opt/sv/seed/cpp
ENV VELOCITAS_HOME=/home/vscode \
    SV_SEED_DIR=${SEED_DIR} \
    SV_TOOLCHAIN=cpp

USER vscode
# ccache dir must exist (owned by vscode) BEFORE the seed build, so the warm cache is baked in and
# docker copies it into a fresh named volume mounted here (otherwise the mount point is root-owned).
ENV CCACHE_DIR=/home/vscode/.ccache
RUN mkdir -p ${CCACHE_DIR}
# Limit parallel compile jobs of Conan source builds (11 GB hosts OOM with nproc jobs).
RUN mkdir -p ~/.conan2 && echo "tools.build:jobs=${CONAN_JOBS}" >> ~/.conan2/global.conf

WORKDIR ${SEED_DIR}
COPY --chown=vscode:vscode templates/vehicle-app-cpp-template/ ./
COPY --chown=vscode:vscode vss/vss_rel_4.0.json /opt/sv/vss/vss_rel_4.0.json
COPY toolchain/cpp/sv-localize-vss.py /usr/local/bin/sv-localize-vss
# VSS is vendored into the project (offline + reproducible); see ADR-0023 Notes.
RUN python3 /usr/local/bin/sv-localize-vss ${SEED_DIR} /opt/sv/vss/vss_rel_4.0.json
COPY toolchain/cpp/sv-offline-overlay.py /usr/local/bin/sv-offline-overlay
RUN python3 /usr/local/bin/sv-offline-overlay ${SEED_DIR}
# googletest archive referenced by app/tests/CMakeLists.txt, pre-extracted for offline configure
RUN GT_URL=$(sed -n 's#^ *URL \(https://github.com/google/googletest/archive/[0-9a-f]*\.zip\)#\1#p' ${SEED_DIR}/app/tests/CMakeLists.txt) \
 && mkdir -p /home/vscode/.sv/deps && cd /home/vscode/.sv/deps \
 && curl -fsSL -o gt.zip "$GT_URL" && python3 -m zipfile -e gt.zip . && rm gt.zip \
 && mv googletest-* googletest && test -f googletest/CMakeLists.txt
ENV SV_GOOGLETEST_SRC=/home/vscode/.sv/deps/googletest

# == onCreateCommand.sh (setup-git / configure-codespaces / upgrade-cli skipped: user- and
#    network-specific; CLI v0.13.2 is already in the base image and pinned in .velocitas.json)
RUN velocitas init -v && velocitas sync
# == setup-dependencies.sh (apt tools, pip requirements, clang-format/tidy, ccache, conan deps)
RUN bash .devcontainer/scripts/setup-dependencies.sh
# Prove the seed builds (warms ccache + conan cache), then keep only caches.
RUN ./build.sh && ./build.sh -r -t app \
 && ls -la build/bin && rm -rf build build-linux-*

# Offline wheelhouse: the Velocitas CLI creates one Python venv PER COMPONENT PER PROJECT PATH
# (~/.velocitas/projects/<md5(path)>/pyvenv/<component>) and pip-installs into it on `velocitas init`.
# New projects therefore need these wheels locally when there is no network.
USER root
RUN mkdir -p /opt/sv/wheels \
 && find /home/vscode/.velocitas/packages ${SEED_DIR} -name 'requirements*.txt' \
      -not -path '*/test*' -not -path '*/.git/*' -not -path '*/build*' -print0 \
    | xargs -0 -I{} python3 -m pip wheel -q --no-cache-dir -r {} -w /opt/sv/wheels \
 && python3 -m pip download -q --no-cache-dir -d /opt/sv/wheels pip setuptools wheel \
 && ls /opt/sv/wheels | wc -l
ENV PIP_FIND_LINKS=/opt/sv/wheels
# Offline SDK source: sdk-installer checks `conan search vehicle-app-sdk@<ver>` (Conan-1 syntax,
# never matches on Conan 2) and therefore ALWAYS git-clones the SDK on `velocitas init`.
# We keep a local bare mirror of the pinned tag; sv-entrypoint rewrites the GitHub URL to it
# (git insteadOf via GIT_CONFIG_* env) when VELOCITAS_OFFLINE=1.
RUN SDK_VER=$(sed -n 's#^vehicle-app-sdk/\([0-9.]*\).*#\1#p' ${SEED_DIR}/conanfile.txt) \
 && git clone -q --bare --depth 1 --branch "v${SDK_VER}" \
      https://github.com/eclipse-velocitas/vehicle-app-cpp-sdk.git /opt/sv/mirrors/vehicle-app-cpp-sdk.git \
 && chown -R vscode:vscode /opt/sv/mirrors \
 && echo "mirrored vehicle-app-cpp-sdk v${SDK_VER}"
# Extra developer tools not in the Velocitas image (used by IDE/clangd + toolchain agent).
RUN apt-get update && apt-get install -y --no-install-recommends clangd-14 \
 && update-alternatives --install /usr/bin/clangd clangd /usr/bin/clangd-14 100 \
 && rm -rf /var/lib/apt/lists/*
COPY toolchain/cpp/sv-entrypoint.sh /usr/local/bin/sv-entrypoint
COPY toolchain/cpp/sv-new-project.sh /usr/local/bin/sv-new-project
RUN chmod 0755 /usr/local/bin/sv-entrypoint /usr/local/bin/sv-new-project
USER vscode
RUN mkdir -p /home/vscode/.sv/conan-offline-index/recipes \
 && conan remote add sv-offline /home/vscode/.sv/conan-offline-index --type=local-recipes-index \
 && conan remote disable sv-offline
ENV VELOCITAS_OFFLINE=1
COPY --from=agent /usr/local/bin/bun /usr/local/bin/bun
COPY --from=agent /src /src
ENV SV_TOOLCHAIN_PORT=4210 SV_PROJECTS_DIR=/workspace/projects
WORKDIR /workspace
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4210/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["sv-entrypoint"]
CMD ["bun", "/src/velocitas-stack/toolchain/agent/src/main.ts"]
