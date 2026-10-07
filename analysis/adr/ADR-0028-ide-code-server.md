# ADR-0028: IDE = code-server trên image toolchain (`ide-vscode`)

- **Status:** Accepted (2026-10-01 — S-6 PASS) · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-IDE-01/02, R5, R16; [10 §1](../10-ide-export-licensing.md#1-ide--ide-vscode); Master Plan 3.5, 4.3, Phase 21

## Decision
1. Repo `ide-vscode` build image `ide-<lang>` **FROM `toolchain-<lang>`** + code-server `4.139.1` (pin) ⇒ IDE có đúng velocitas CLI/Conan/CMake/SDK như pipeline.
2. Mở `/workspace/projects` (multi-folder) — URL `?folder=/workspace/projects/<slug>` từ SynCode response.
3. Extensions: chỉ Open VSX whitelist (clangd, cmake-tools, clang-format, vsmqtt, test adapter, lldb/gdb debug); **không** ms-vscode.cpptools/Pylance.
4. Settings overlay: clangd `--compile-commands-dir=build`, tasks "SimVehicleApp: Build/Test/Run on stack" (env trỏ databroker/mqtt compose), `files.readonlyInclude` cho `app/src/generated/**` (nhắc DO NOT EDIT).
5. Auth MVP: password từ `.env`; port 8080 bind localhost. P2: reverse proxy + forward-auth.
6. Sim **không** gọi API của IDE; chỉ điều hướng URL.

## Alternatives considered
| Phương án | Vì sao loại |
|---|---|
| openvscode-server (Gitpod) | Tương đương; code-server release đều hơn (4.139.1 @2026-09) và master plan đã chọn |
| IDE nhúng Monaco trong studio | Không có terminal/build/debug đầy đủ |
| Image code-server riêng không có toolchain | IDE không build được app |

## Verification
Từ SynCode mở IDE → thấy file generated; task Build thành công; task Run on stack kết nối databroker; clangd go-to-definition vào SDK headers.

## Notes / Deviations (M0, 2026-10-01)
- Implemented in `modules/ide-vscode/` (image 4.37 GB). Extensions installed from Open VSX: clangd 0.6.0, cmake-tools 1.24.42, twxs.cmake, clang-format 1.9.0, vsmqtt 1.8.3, markdown-mermaid, webfreak.debug. `clangd-14` added in the toolchain image; `clangd --check` on project sources → 0 errors.
- Build context uses `docker-image://${SV_TOOLCHAIN_IMAGE}` (not `service:`) so the module stays buildable standalone; `scripts/sv build` builds the toolchain first.
- IDE entrypoint goes through `sv-entrypoint` (same offline behaviour as the toolchain). Toolchain and IDE share `sv-workspace`, `sv-conan2`, `sv-velocitas`, `sv-ccache` volumes (verified: init in toolchain, build in IDE).

## Notes / Deviations (2026-10-07) — M9, theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- **Tasks ở mức user** (`settings/tasks.json` của `ide-vscode`, chép vào `~/.local/share/code-server/User/` lúc khởi động nếu chưa có): *SimVehicleApp: Build* (`./install_dependencies.sh && ./build.sh`, như stage build của SynCode), *Test* (`app_generated_tests` + `app_utests`), *Run on stack* (`sv-run-on-stack`: đọc `vssRelease` của `.simvehicleapp/project.json`, chọn databroker theo `SV_DATABROKERS` (ADR-0024 §6), MQTT của stack, `SV_TRACE_LEVEL=node`). Launch gdb (`webfreak.debug`, type `gdb`) trong settings (`launch`) — không dùng `cppdbg` (cần ms-vscode.cpptools, cấm).
- **Overlay xoá `.vscode/{tasks,launch,c_cpp_properties}.json` của template** (`compiler-code-cpp/template-overlay/overlay.json`): các task `velocitas exec runtime-local …` cần Docker-in-Docker (không có, ADR-0005) và launch `cppdbg` cần cpptools; để lại sẽ là task hỏng trong IDE.
- **Open IDE:** `Project.editor.url` (orchestrator, khi project `ready` và license cho `ide.access`) — studio chỉ mở URL (§6). Cảnh báo chạy song song (M09-T05): dòng nhắc trong Run console và trong `sv-run-on-stack` (hai app cùng điều khiển một databroker).
