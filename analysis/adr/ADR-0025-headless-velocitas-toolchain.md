# ADR-0025: Toolchain Velocitas headless (thay devcontainer) — `velocitas-stack/toolchain-<lang>`

- **Status:** Accepted with revisions (2026-10-01 — S-1 + E-1 PASS) · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-PLT-02, FR-RUN-02/03, NFR-05, R14, R15; [00 §3.3](../00-research-findings.md#33-build-headless-không-cần-devcontainer--bằng-chứng-từ-appdockerfile); [04 §6](../04-velocitas-deep-dive.md#6-velocitas-không-devcontainer--cách-simvehicleapp-dựng-môi-trường)

## Context
Template tự chứng minh build headless được: `FROM devcontainer-base-images/cpp:v0.4` → `pip install -r requirements.txt && velocitas init -f -v && ./install_dependencies.sh -r && ./build.sh -r -t app --static`. `velocitas init` tải package từ GitHub (cần mạng/token).

## Decision
1. Image `toolchain-cpp`:
   ```dockerfile
   FROM ghcr.io/eclipse-velocitas/devcontainer-base-images/cpp:v0.4@sha256:<pin>
   # tools như setup-dependencies.sh: clang-format-14, clang-tidy-14, cppcheck, ccache, gdb
   COPY templates/vehicle-app-cpp-template@275e858 /opt/sv/templates/cpp          # vendored snapshot (có LICENSE/NOTICE)
   RUN cd /opt/sv/seed && cp -a /opt/sv/templates/cpp/. . \
    && pip install -r requirements.txt && velocitas init -f -v \
    && velocitas exec vehicle-signal-interface download-vspec && velocitas exec vehicle-signal-interface generate-model \
    && ./install_dependencies.sh && ./install_dependencies.sh -r        # Conan cache Debug+Release
   COPY agent/dist/toolchain-agent /usr/local/bin/                      # Bun single binary
   ENV VELOCITAS_OFFLINE=1
   USER vscode
   ENTRYPOINT ["toolchain-agent"]
   ```
   (Chi tiết chính xác chốt sau spike S-1: vị trí cache `~/.velocitas`, `~/.conan2`, cách tái dùng vehicle-model cho project mới.)
2. **Toolchain Agent** (TS → `bun build --compile`) API: `POST /jobs {kind: init|deps|build|test|format-check|run|stop|generate-model, project, options}`, `GET /jobs/:id`, `GET /jobs/:id/stream` (SSE), `POST /jobs/:id/cancel`, `GET /templates` (tar template + overlay seed), `/healthz`, `/version`.
3. Job lệnh (C++): `init` = copy seed velocitas state vào project + `velocitas init` offline; `deps` = `./install_dependencies.sh`; `build` = `./build.sh [-r]` (ccache); `test` = `ctest --test-dir build --output-on-failure`; `format-check` = `clang-format --dry-run --Werror` trên `generated/`; `run` = spawn `build/bin/app` với env stack; `stop` = SIGINT, 5 s rồi SIGKILL.
4. Hàng đợi: 1 build job/lúc/toolchain (Conan lock), 1 run/lúc.
5. Volumes: `sv-conan` (`~/.conan2`), `sv-ccache`, `sv-workspace`. Lần đầu volume trống ⇒ entrypoint seed từ cache trong image.
6. Online mode (`VELOCITAS_OFFLINE=0`, `GITHUB_API_TOKEN`) cho phép `velocitas upgrade`/VSS release khác chưa bake.
7. `velocitas-stack` cũng chứa: templates vendored (+ script cập nhật theo lock), configs databroker/mosquitto/mock, image `toolchain-python` (M12).

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| Gọi CMake/Conan trực tiếp, bỏ velocitas CLI | Lệch toolchain chính thức; export không tương thích |
| Build trong container tạm mỗi lần (`docker run`) | Cần docker socket |
| Không bake cache | Mỗi build cần internet, chậm, rate-limit GitHub |

## Verification
Spike S-1 số liệu; CI build image; test offline: `docker run --network none toolchain-cpp` build project mới từ template thành công.

## Notes / Deviations (M0, 2026-10-01) — implemented design
- **Layering changed:** toolchain image is built `FROM` the **template's own `.devcontainer/Dockerfile` image** (compose build-stage service `devcontainer-cpp`, `additional_contexts: devcontainer: service:devcontainer-cpp`), then replays `onCreateCommand.sh` (velocitas init/sync, setup-dependencies.sh) at build time ⇒ byte-for-byte the devcontainer environment. Files: `modules/velocitas-stack/toolchain/cpp/*`.
- **Offline kit** (all verified with `--network none` on a new project path): wheelhouse `/opt/sv/wheels` (CLI makes per-project-path venvs); SDK bare mirror + git `insteadOf` (sdk-installer always clones because its Conan-1 `conan search name@ver` never matches); conancenter disabled + empty `local-recipes-index` remote `sv-offline`; VSS vendored into project; googletest pre-extracted + `SV_GOOGLETEST_SRC` guard.
- **Timings:** image build 3m20s (only SDK + vehicle model compiled; deps prebuilt from Conan Center); new project offline: init 26 s, deps 2 s, build 10 s warm / 87 s cold.
- **`./build.sh` returns 0 when CMake configure fails** ⇒ agent checks `build/bin/app`. `ctest` finds no tests (template calls `enable_testing()` after `add_subdirectory`) ⇒ run `build/bin/app_utests --gtest_output=xml:…`.
- uid of `vscode` is **4000** (not 1000). Every volume mount point must pre-exist in the image owned by vscode (`CCACHE_DIR`).
- `vehicle-model/generated` is a single Conan ref per cache ⇒ agent must re-run `generate-model` when a project's VSS hash differs from the last exported one.
- Agent (Toolchain API) not yet implemented — M7. M0 uses `sv-new-project` + `docker compose exec`.
