# syntax=docker/dockerfile:1.7
# SimVehicleApp toolchain-python (ADR-0040 §4)
# ---------------------------------------------------------------------------
# Layer 1 ("devcontainer") is the vehicle-app-python-template's OWN .devcontainer image
# (compose service devcontainer-python), like toolchain-cpp. Layer 2 replays the template's
# onCreateCommand.sh (velocitas init/sync + setup-dependencies.sh) at IMAGE BUILD time and keeps a
# wheelhouse of every pinned requirement, so containers start ready and work offline (VELOCITAS_OFFLINE=1).
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.8-debian AS agent
WORKDIR /src/velocitas-stack/toolchain/agent
COPY --from=contracts / /src/simvehicleapp-contracts/
COPY toolchain/agent/package.json toolchain/agent/bun.lock toolchain/agent/bunfig.toml ./
RUN bun install --frozen-lockfile --production
COPY toolchain/agent/src src

FROM devcontainer AS toolchain

ARG SEED_DIR=/opt/sv/seed/python
ENV VELOCITAS_HOME=/home/vscode \
    SV_SEED_DIR=${SEED_DIR} \
    SV_TOOLCHAIN=python \
    SV_MODEL_HASH_FILE=/home/vscode/.sv/model-hash \
    PIP_DISABLE_PIP_VERSION_CHECK=1

USER vscode
WORKDIR ${SEED_DIR}
COPY --chown=vscode:vscode templates/vehicle-app-python-template/ ./
COPY --chown=vscode:vscode vss/vss_rel_4.0.json /opt/sv/vss/vss_rel_4.0.json
COPY toolchain/cpp/sv-localize-vss.py /usr/local/bin/sv-localize-vss
# VSS is vendored into the project (offline + reproducible); see ADR-0023 Notes.
RUN python3 /usr/local/bin/sv-localize-vss ${SEED_DIR} /opt/sv/vss/vss_rel_4.0.json

# == onCreateCommand.sh (setup-git / configure-codespaces / upgrade-cli skipped: user- and
#    network-specific; CLI v0.13.2 is in the base image and pinned in .velocitas.json)
RUN velocitas init -v && velocitas sync
# == setup-dependencies.sh: pip requirements of the template, the app and its tests (online at build time)
RUN bash .devcontainer/scripts/setup-dependencies.sh
# Generated code is checked with the template's own ruff pin (.pre-commit-config.yaml: ruff-pre-commit v0.9.10).
RUN pip3 install ruff==0.9.10 && ruff --version && python3 -c "import velocitas_sdk, pytest; print('sdk ok')"

# Offline wheelhouse: every requirements file of the template and of the Velocitas component venvs, + ruff.
USER root
RUN mkdir -p /opt/sv/wheels \
 && find /home/vscode/.velocitas/packages ${SEED_DIR} -name 'requirements*.txt' \
      -not -path '*/.git/*' -not -path '*/build*' -print0 \
    | xargs -0 -I{} python3 -m pip wheel -q --no-cache-dir -r {} -w /opt/sv/wheels \
 && python3 -m pip download -q --no-cache-dir -d /opt/sv/wheels pip setuptools wheel ruff==0.9.10 \
 && ls /opt/sv/wheels | wc -l
ENV PIP_FIND_LINKS=/opt/sv/wheels
COPY toolchain/python/sv-entrypoint.sh /usr/local/bin/sv-entrypoint
COPY toolchain/cpp/sv-new-project.sh /usr/local/bin/sv-new-project
RUN chmod 0755 /usr/local/bin/sv-entrypoint /usr/local/bin/sv-new-project
USER vscode
RUN mkdir -p /home/vscode/.sv
ENV VELOCITAS_OFFLINE=1
COPY --from=agent /usr/local/bin/bun /usr/local/bin/bun
COPY --from=agent /src /src
ENV SV_TOOLCHAIN_PORT=4220 SV_PROJECTS_DIR=/workspace/projects
WORKDIR /workspace
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:4220/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["sv-entrypoint"]
CMD ["bun", "/src/velocitas-stack/toolchain/agent/src/main.ts"]
