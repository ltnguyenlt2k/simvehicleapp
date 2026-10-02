# velocitas-stack (L5 — Toolchain & Vehicle Runtime)

Everything "Velocitas" for SimVehicleApp, **without requiring VS Code Dev Containers** — but staying
100 % compatible with them (exported projects still open with "Reopen in Container").

| Service | What | Notes |
|---|---|---|
| `devcontainer-cpp` | the template's own `.devcontainer/Dockerfile` image | build-stage only (exits) |
| `toolchain-cpp` | devcontainer image + replayed `onCreateCommand` (velocitas init/sync, setup-dependencies, conan) + offline kit | `sv-new-project <dir>` creates & inits a project offline |
| `databroker` | KUKSA 0.5.0 `--insecure --enable-databroker-v1 --vss /vss/vss_rel_4.0.json` | same as Velocitas runtime-local |
| `mqtt` | mosquitto 2.0.14 (1883 + websockets 9001) | |
| `mock-provider` | KUKSA mock provider 0.4.1 (`--profile mock`) | `runtime/mock/mock.py` mirrors actuator target→current |

## Offline kit (VELOCITAS_OFFLINE=1, verified with `--network none`)
1. Velocitas packages cloned at image build (`~/.velocitas/packages`, CLI tolerates failed fetches).
2. **pip wheelhouse** `/opt/sv/wheels` — CLI creates one venv per component *per project path*.
3. **SDK git mirror** `/opt/sv/mirrors/vehicle-app-cpp-sdk.git` + `insteadOf` (sdk-installer always re-clones: its `conan search name@ver` check is Conan-1 syntax).
4. **Conan**: conancenter disabled + empty `local-recipes-index` remote `sv-offline` enabled (`conan search` fails with zero remotes).
5. VSS vendored into each project (`app/vss/vss_rel_4.0.json`), googletest pre-extracted (`SV_GOOGLETEST_SRC`).

## Commands
```bash
docker compose -f modules/velocitas-stack/compose.yaml up -d        # standalone
docker compose exec toolchain-cpp sv-new-project /workspace/projects/demo
docker compose exec toolchain-cpp bash -lc 'cd /workspace/projects/demo && ./install_dependencies.sh && ./build.sh && test -x build/bin/app'
```
⚠️ `./build.sh` exits 0 even when CMake configure fails (upstream) — always check `build/bin/app`.
Spike evidence: `docs/spikes/M0-spikes-report.md`.
