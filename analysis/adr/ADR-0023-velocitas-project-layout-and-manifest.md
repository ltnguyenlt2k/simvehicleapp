# ADR-0023: Layout project Velocitas & thuật toán merge AppManifest v3

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L1
- **Related:** FR-CG-05, FR-WF-05, R10; Master Plan 8.3, 8.5; [03 §6](../03-system-architecture.md#6-workspace-layout-volume-sv-workspace)

## Context
Template C++: `.velocitas.json` (`appManifestPath=app/AppManifest.json`), app ở `app/src`, test `app/tests`. AppManifest v3 thật dùng `datapoints.required[] {path, required:"true", access}`; `provided[]`; `pubsub.reads/writes`; `grpc-interface`.

## Decision
1. **1 project SimVehicleApp = 1 Velocitas vehicle app** = 1 thư mục `/workspace/projects/<slug>` copy từ template pin (SHA trong lock) + overlay từ backend.
2. Đọc `appManifestPath` từ `.velocitas.json` (không hard-code). `.velocitas.json` chỉ ghi lúc init (đặt `githubRepoId`? giữ nguyên), sau đó read-only.
3. Vùng sở hữu: `app/src/generated/**`, `app/tests/generated/**` (SynCode); `app/src/user/**` (người dùng, tạo 1 lần); `app/src/simvehicleapp-runtime/**` (runtime, cập nhật có kiểm soát); còn lại thuộc template/người dùng.
4. **Merge AppManifest (idempotent):**
   1. Đọc manifest (không có ⇒ tạo `manifestVersion: v3`, `name: <AppName>`).
   2. Hợp các `manifestFragment` của mọi workflow **enabled** trong project.
   3. `vehicle-signal-interface`: `src` = URL release VSS của project; datapoints required = union theo `path`; `access` = `write` nếu có ghi, ngược lại `read`; entry do SimVehicleApp quản lý thêm `"x-sv-managed": true` (key tuỳ biến — **đã xác nhận an toàn**, xem Notes; không cần fallback file riêng, nhưng vẫn giữ `.simvehicleapp/manifest-managed.json` làm bản sao phòng hờ/audit).
   4. `pubsub`: union reads/writes; managed tương tự.
   5. Xoá entry managed không còn dùng; **không bao giờ** xoá entry không managed.
   6. Sort ổn định (path/topic), giữ thứ tự interface, format 4 spaces như template ⇒ diff nhỏ.
5. `name` trong AppManifest = `appName` project (PascalCase), đồng bộ với tên class app host.
6. Handler theo `manifestVersion` (v3 hiện tại) — thêm version mới = thêm handler (R10).
7. Sau khi đổi datapoints/VSS src ⇒ toolchain chạy lại `vehicle-signal-interface generate-model` nếu `src` đổi (build job tự phát hiện qua hash).

## Verification
SynCode 2 lần liên tiếp ⇒ AppManifest byte-identical; entry thêm tay giữ nguyên; tắt workflow ⇒ entry managed của nó bị xoá.

## Notes / Deviations (2026-10-01) — đóng câu hỏi "spike" về key tuỳ biến `x-sv-managed`
Đọc trực tiếp 2 đường code duy nhất từng chạm `AppManifest.json` trong toàn bộ Velocitas tooling:
- **CLI (TypeScript, `eclipse-velocitas/cli`)**: `AppManifest.read()` (`src/modules/app-manifest.ts`) chỉ làm `JSON.parse(file)` thuần, không có bất kỳ bước validate JSON Schema/`additionalProperties` nào. `AppManifest.write()`/constructor (có bước `_createInterfaceEntries` thử `JSON.parse` từng value trong `config`) **chỉ được gọi bởi lệnh `velocitas create`** (tạo project mới tương tác) — pipeline SimVehicleApp **không bao giờ** gọi `velocitas create` (ta copy template đã pin + workspace-service tự ghi file), nên code path này không bao giờ chạm vào manifest của SimVehicleApp.
- **Python (`velocitas_lib.get_app_manifest()`)**: cũng chỉ `json.loads(...)`, không schema check; `vehicle-signal-interface`/`grpc-interface-support` chỉ đọc đúng các key chúng cần qua `interface["type"]`/`interface["config"]`, không kiểm tra "không được có key lạ".
⇒ **Kết luận dứt khoát**: không có component nào trong Velocitas CLI/toolchain validate hay từ chối key lạ trong `AppManifest.json`. Thêm `"x-sv-managed": true` vào từng entry (datapoint/topic) là an toàn tuyệt đối với mọi phiên bản tooling đã khảo sát (CLI v0.13.2, devenv-devcontainer-setup v3.0.0). Rủi ro duy nhất còn lại là **phiên bản Velocitas tương lai** có thể thêm validate nghiêm ngặt hơn — do đó vẫn giữ `.simvehicleapp/manifest-managed.json` làm nguồn sự thật song song (không phải vì cần thiết hôm nay, mà để chịu được thay đổi tooling sau này mà không phải đổi format file manifest).

## Notes / Deviations (M0, 2026-10-01)
- **VSS vendored into each project**: `app/vss/<release>.json`, AppManifest `vehicle-signal-interface.config.src` = that relative path (supported by `velocitas_lib.obtain_local_file_path`). Offline + reproducible; verified in toolchain, IDE and exported devcontainer.
- Project overlay adds a guard in `app/tests/CMakeLists.txt` (`# SV: offline googletest`) that is a no-op unless `SV_GOOGLETEST_SRC` is set.
- Exported project keeps the template `.devcontainer/` and runs with `devcontainer up` + `runtime-local` (E-1 PASS).

## Notes / Deviations (2026-10-07) — M6 (backend C++), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
- Overlay một lần (`GET /template-overlay/files`): `app/src/CMakeLists.txt` (target `app` = generated + `user/*.cpp` + runtime vendored), `app/src/user/UserHooks.*` (`simvehicleapp::user::onAppStart/onAppStop`), `app/tests/CMakeLists.txt` (giữ googletest đúng pin + guard offline của toolchain, thêm `generated/` và `utests/` nếu có); xoá `SampleApp.*`, `Launcher.cpp`, `utests/SampleApp_test.cpp`, `utests/CMakeLists.txt` qua `FileBundle.remove`.
- `manifestFragment` của backend **không** mang `vehicle-signal-interface.src`: nguồn VSS là việc của workspace (VSS vendored `app/vss/<release>.json`, Notes M0); fragment chỉ có `required[] {path, access}` (write thắng read) và `pubsub.reads/writes`, đã sort.
- (M7) Lúc tạo project, entry datapoint/topic của sample app trong AppManifest bị xoá cùng sample app (`name` = appName). Merge: entry thêm tay giữ nguyên (không bao giờ xoá), nhưng nếu workflow **ghi** vào path đó mà entry tay khai `read` thì nâng `access` lên `write` (app cần quyền ghi); topic do SimVehicleApp quản lý được theo dõi trong `.simvehicleapp/manifest-managed.json` (chuỗi không mang được `x-sv-managed`). Merge hai lần cùng fragment ⇒ cùng byte (test).
