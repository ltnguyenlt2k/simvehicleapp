# BASELINE — pinned upstream inputs (M0, 2026-10-01)

| Input | Pin | Where it lives |
|---|---|---|
| simstudioai/sim | tag `v0.7.13` = `ad0b8678b5dc4b6d5703481d567f29c9facc6f67` (2026-06-24) | `modules/simvehicleapp-studio/` (snapshot, no .git) |
| eclipse-velocitas/vehicle-app-cpp-template | `275e858e3de8f43d6b4c71a389e358dffe73b42b` (2026-01-05) | `modules/velocitas-stack/templates/vehicle-app-cpp-template/` |
| eclipse-velocitas/vehicle-app-python-template | `e7082f75d1831489462f6672b6858f7ea7708256` (2025-07-07) | `modules/velocitas-stack/templates/vehicle-app-python-template/` |
| eclipse-velocitas/vehicle-app-cpp-sdk | tag `v0.7.1` (conanfile `vehicle-app-sdk/0.7.1`) | bare mirror inside toolchain image |
| Velocitas packages | devenv-runtimes v4.1.0 · devenv-devcontainer-setup v3.0.0 · devenv-github-workflows v7.0.0 · devenv-github-templates v1.0.5 · CLI v0.13.2 | baked in toolchain image (`~/.velocitas/packages`) |
| COVESA VSS | v4.0 `vss_rel_4.0.json` sha256 `925d9e1b5bd187694b3e03051a50777fdd5b46a5a5c4f48fd49ca270a07cdc50` | `modules/velocitas-stack/vss/` |
| @modelcontextprotocol/sdk | `1.32.1` exact (ai-assistant MCP server + client; M10, 2026-10-07) | `modules/simvehicleapp-ai/package.json` + `bun.lock` |

## Container images (registry digests resolved 2026-10-01)
| Image | Digest |
|---|---|
| ghcr.io/eclipse-velocitas/devcontainer-base-images/cpp:v0.4 | `sha256:a966412b938f34c34edd8411186130f630305590a56a7650204b23b687c3fc89` |
| ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0 | `sha256:4fa9d98197fd7d144dccfba9473e83ea30b7eff3afb06e2acf558c588b8da1cc` |
| eclipse-mosquitto:2.0.14 | `sha256:b5f3829be419e03d7dba8cf4a5870de64c702f840360386f6b856134300b0d15` |
| ghcr.io/eclipse-kuksa/kuksa-mock-provider/mock-provider:0.4.1 | `sha256:bc61857ab6b29f70332daa10b2cd835729cecd6605cc5fe48a35f9e0236c32bb` |
| pgvector/pgvector:pg17 | `sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f` |
| code-server | release `4.139.1` (.deb, installed in `ide-cpp`) |

## Toolchain image facts (from the Velocitas base image)
Ubuntu 22.04.5 · gcc 11.4 · CMake 3.22.1 · Conan 2.24.0 · Python 3.10.12 · velocitas-cli 0.13.2 · user `vscode` **uid/gid 4000**.

Local build artifacts (not reproducible digests, rebuilt by `scripts/sv build`): `simvehicleapp/devcontainer-cpp:dev`, `simvehicleapp/toolchain-cpp:dev` (3.59 GB), `simvehicleapp/ide-cpp:dev` (4.37 GB).
Upstream drift policy: ADR-0003. Integrity (2026-10-03): `scripts/upstream_tree_check.py` (CI job `vendored-trees`) — both templates match their pins exactly (content + mode); the studio matches v0.7.13 except changes declared in `modules/simvehicleapp-studio/UPSTREAM_SYNC.allow`. Import fixes: exec bits restored and template files dropped by its own `build*` ignore re-added (commit `ac0f165`). Spike evidence: `docs/spikes/M0-spikes-report.md`.
