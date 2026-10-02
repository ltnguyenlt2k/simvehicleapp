# M0 — Spike report (S-1 … S-6 + end-user devcontainer)

- **Date:** 2026-10-01 · **Host:** WSL2 Ubuntu, Docker 29.4.0, Compose v5.1.3, 20 CPU, 11.5 GB RAM
- **Scope:** questions left open by analysis/13 §3, plus the PO requirement "exported project must still run by just opening the devcontainer".
- **Re-run:** `scripts/sv smoke` (S-1/S-2/S-3 automated) · `spikes/s2-s4-databroker/` · `spikes/s5-sim-minimal/`

| Spike | Question | Result | Evidence |
|---|---|---|---|
| S-1 | Build Velocitas C++ app headless, without devcontainer, offline? | **PASS** (after 5 fixes, §1) | new project with `--network none`: init 26 s, deps 2 s, build 10 s (warm ccache) / 87 s (cold); `app` + `app_utests` + `compile_commands.json` |
| S-2 | databroker 0.5.0 flags; app ↔ databroker/MQTT in compose by hostname | **PASS** | unmodified template SampleApp: `Using Kuksa Databroker sdv.databroker.v1 API`, `via 'databroker:55555'`, injected 88.5/131.0 → MQTT `sampleapp/currentSpeed {"speed":88.5}`, `{"speed":131.0}` |
| S-3 | SDK `set()` → current or target? | **PASS — target only** | source `databroker/src/grpc/sdv_databroker_v1/broker.rs` (tag 0.5.0) + live test 8/8 |
| S-4 | mock-provider 0.4.1 configuration | **PASS** | `VDB_ADDRESS=databroker:55555`, mount `/mock/mock.py`; mirrors target→current (live test 8/8) |
| S-5 | Sim v0.7.13 minimal compose | **PASS** | db + migrations + realtime + simstudio; sign-up, workspace, workflow created via API; ~450 MB RAM |
| S-6 | code-server FROM toolchain, clangd works | **PASS** | 7 Open VSX extensions; `clangd --check=app/src/SampleApp.cpp` → `All checks completed, 0 errors` |
| E-1 | Exported project opens with Dev Containers and runs | **PASS** | `@devcontainers/cli up` 2m40s (online onCreate), `./build.sh` OK, utest OK, `velocitas exec runtime-local up` → "Runtime is ready", app "App is running" |

---

## 1. S-1 — Velocitas without devcontainer: what was actually needed

Design: **layer 1 = the template's own `.devcontainer/Dockerfile` image** (compose service `devcontainer-cpp`), **layer 2 = `toolchain/cpp/Dockerfile`** that replays `onCreateCommand.sh` at image build time. So the toolchain is the same environment VS Code would create.

Online build of the image: 3 min 20 s first time (only `vehicle-app-sdk` and `vehicle-model/generated` compiled locally; all other Conan deps are prebuilt binaries from Conan Center for gcc 11 / Release — template default "Mixed" = deps Release + app Debug). Image 3.59 GB (devcontainer image 2.72 GB).

Offline (new project path, `--network none`) failed 5 times; each root cause and fix:

| # | Symptom | Root cause (verified in source) | Fix (in image, project unchanged unless noted) |
|---|---|---|---|
| 1 | `No module named 'velocitas_lib'` | Velocitas CLI creates **one Python venv per component per project path**: `~/.velocitas/projects/<md5(path)>/pyvenv/<component>` (`cli/src/modules/exec.ts`) → `pip install` from PyPI on every new project | Wheelhouse `/opt/sv/wheels` (61 wheels) + `PIP_FIND_LINKS`; `PIP_NO_INDEX=1` when offline |
| 2 | `download-vspec` needs GitHub | VSS URL cached per project path | **Vendor VSS into the project** `app/vss/vss_rel_4.0.json`, AppManifest `src` = relative path (`velocitas_lib.obtain_local_file_path` accepts workspace-relative paths) — also makes exports reproducible |
| 3 | `sdk-installer run` git-clones SDK | `is_package_installed` runs `conan search vehicle-app-sdk@0.7.1` (Conan-1 syntax) → never matches on Conan 2 → always clones | Bare mirror `/opt/sv/mirrors/vehicle-app-cpp-sdk.git` (tag v0.7.1, owned by vscode) + git `insteadOf` via `GIT_CONFIG_*` env when offline |
| 4 | conan asks conancenter for `cmake/3.31.10` | remote lookup for skippable tool binary | offline: disable `conancenter`; keep an **empty `local-recipes-index` remote** `sv-offline` enabled (`conan search` errors when zero remotes are enabled) |
| 5 | CMake configure downloads googletest | `app/tests/CMakeLists.txt` FetchContent URL | pre-extracted archive + `SV_GOOGLETEST_SRC`; project gets a **no-op-unless-env guard** (`sv-offline-overlay.py`) → online/devcontainer behaviour identical |

Additional facts found:
- **`./build.sh` exits 0 even when CMake configure fails** → orchestrator/toolchain agent must check the artifact (`build/bin/app`), never only the exit code.
- `ctest` finds no tests (root `CMakeLists.txt` calls `enable_testing()` *after* `add_subdirectory(app)`) → run `build/bin/app_utests` directly (gtest, `--gtest_output=xml`).
- Velocitas image: Ubuntu 22.04, gcc 11.4, CMake 3.22, Conan 2.24.0, Python 3.10, velocitas-cli 0.13.2, **user `vscode` uid/gid 4000** (docker group 999), has docker CLI, no clangd, no ccache (ccache comes from setup-dependencies).
- Named volume mounted at a path absent in the image is created root-owned → create `CCACHE_DIR` (and every mount point) as `vscode` in the image.
- `vehicle-model/generated` is ONE Conan reference shared by all projects in a Conan cache → projects with different VSS releases must regenerate the model before building (toolchain agent responsibility, ADR-0025 note).

## 2. S-2 — databroker 0.5.0
`--help` (verified): `--address` (env `KUKSA_DATABROKER_ADDR`, image sets `0.0.0.0`), `--port` (55555), `--vss <FILE>` (env `KUKSA_DATABROKER_METADATA_FILE`, **image embeds `vss_release_4.0.json`**), `--insecure`, `--disable-authorization`, `--jwt-public-key`, `--tls-cert/--tls-private-key`, `--enable-viss`, `--viss-address/--viss-port`, **`--enable-databroker-v1`**, `--worker-threads`. Image is distroless-like (no shell).
Compose command used: `--insecure --enable-databroker-v1 --vss /vss/vss_rel_4.0.json`.
SDK behaviour: on subscribe the first `onItem` arrives with `NOT_AVAILABLE` if no value yet; template code then logs `Vehicle.Speed has no valid value` → runtime must check availability. App logs contain ANSI colour codes → strip before parsing.

## 3. S-3 — `set()` semantics (sdv.databroker.v1, SDK default)
`Broker.SetDatapoints`: sensor/attribute → `ACCESS_DENIED`; actuator → writes **`actuator_target` only**; value outside `allowed` → `OUT_OF_BOUNDS`. Without a provider the current value stays unset.
`kuksa.val.v1 set_current_values` on a sensor works (= how UI injection / feeders write). `sdv.databroker.v1 GetDatapoints` returns the injected current value.
**Decision:** signal-gateway shows *current* and *target*; in dev runs it mirrors target→current for actuators the project writes (dynamic, no restart) — the role of a provider. mock-provider stays optional (`--profile mock`) for richer behaviours.

## 4. S-4 — mock-provider 0.4.1
Entry `./mockprovider.py`, env `VDB_ADDRESS` (default `127.0.0.1:55555`), `MOCK_ADDR` (default `0.0.0.0:50053`), behaviours from `/mock/mock.py` (Python DSL, loaded **at startup only**), uses `kuksa_client` (kuksa.val.v1). Default upstream mock animates `Vehicle.Speed` 0→100 continuously — **must be replaced** (would fight UI injection). Our `runtime/mock/mock.py` mirrors target→current for listed actuators.

## 5. S-5 — Sim minimal
Required: `db` (pgvector pg17), `migrations` (`bun run db:migrate`), `realtime`, `simstudio`. Not required: Trigger.dev (`TRIGGER_DEV_ENABLED` unset), Redis, pii, copilot. **realtime must start after migrations** (boot-time schema preflight fails otherwise). Secrets: `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `API_ENCRYPTION_KEY`, `INTERNAL_API_SECRET`. Email verification not enforced without a mailer. Prebuilt images `ghcr.io/simstudioai/{simstudio,realtime,migrations}:v0.7.13` exist. Source build: see §8.

## 6. S-6 — IDE
`ide-cpp` = `FROM simvehicleapp/toolchain-cpp:dev` + code-server 4.139.1 (4.37 GB). Extensions: vscode-clangd 0.6.0, cmake-tools 1.24.42, cmake 0.0.17, clang-format 1.9.0, vsmqtt 1.8.3, markdown-mermaid 1.32.1, webfreak.debug 0.27.0. `clangd-14` + `compile_commands.json` (exported by the Velocitas build-system) → 0 errors. Toolchain and IDE share `sv-workspace`, `sv-conan2`, `sv-velocitas`, `sv-ccache` volumes: project initialised in toolchain, built in IDE ✔.

## 7. E-1 — end-user devcontainer
Exported project (= SimVehicleApp project minus build dirs) contains the template's `.devcontainer/` untouched, AppManifest `src: app/vss/vss_rel_4.0.json`, googletest guard. `devcontainer up` (online) → onCreate (`velocitas init/sync`, setup-dependencies) **success**; `./build.sh` ✔; `app_utests` ✔; `velocitas exec runtime-local up` (Docker-in-Docker inside the devcontainer) ✔; `run-vehicle-app` ✔.

## 8. Sim from source
| Image | Result |
|---|---|
| `simvehicleapp/studio-migrations:dev` (`docker/db.Dockerfile`) | ✔ built (504 MB) |
| `simvehicleapp/studio-realtime:dev` (`docker/realtime.Dockerfile`) | ✔ built (367 MB) |
| `simvehicleapp/studio:dev` (`docker/app.Dockerfile`, Next.js) | ✘ **not built on this host** |

`studio` attempts: (1) exit 137 (OOM-killed) while another build ran in parallel; (2) host restarted mid-build; (3) built alone: stuck at `next build` → "Creating an optimized production build …" for 2 h (no error, no progress) and stopped by the time limit.
**Root cause: NOT verified.** Attempt (1) was a real OOM kill but ran concurrently with other builds; attempt (3) stalled without any error and memory was not measured during the stall. Facts only: the build script sets an 8 GB heap *limit* (`NODE_OPTIONS='--max-old-space-size=8192'`, a cap, not actual usage); WSL2 here has 11.5 GB shared with other containers. Other possible causes (Docker cache mounts on WSL, Turbopack in container) were not ruled out. The PO reports building Sim normally before.
Scope note: ~5 300 of 9 458 TS/TSX files in `apps/sim` (tools 4 091, triggers 379, blocks 273, copilot 279, connectors 160, landing 100, ee 28, enrichments 21) are removed by the M1/M11 refactor, so build time/memory are expected to drop substantially — to be measured in M1, not assumed.
**Options:** (a) raise WSL memory in `%UserProfile%\.wslconfig` (`memory=18GB`, `swap=8GB`, then `wsl --shutdown`); (b) build the studio image on CI / a ≥ 16 GB machine and pull it; (c) until then, run the prebuilt `ghcr.io/simstudioai/simstudio:v0.7.13` (functionally verified in S-5). M1 changes the source, so (a) or (b) is required before M1-T02c.

## 9. Host notes
- Ports 3000 and 8080 were already used on this host → `.env` sets `SV_STUDIO_PORT=3300`, `SV_IDE_PORT=8088`.
- The repo lives on `/mnt/d` (Windows NTFS via WSL). Builds run inside Docker volumes so performance is fine; for editing/`git` speed consider moving the repo to the WSL filesystem (`~/…`).
