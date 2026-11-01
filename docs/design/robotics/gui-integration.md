# Tích hợp miền Robot vào GUI SimVehicleApp hiện có

> Quyết định: [ADR-0068](../../../analysis/adr/ADR-0068-robotics-domain-in-existing-studio.md). Trạng thái: **thiết kế**, chưa có code. Điểm gắn dưới đây được đối chiếu với source `modules/simvehicleapp-studio` tại `3eea2498` (2026-11-01).

## 1. Nguyên tắc

1. **Một GUI.**
   - Mọi việc soạn, kiểm tra, test, build, deploy, chạy và quan sát workflow robot diễn ra trong studio hiện có (`apps/sim`).
   - Không web app riêng, không iframe tới một trình soạn khác.
2. **Miền (domain) theo workflow.**
   - Mỗi workflow là `vehicle` (mặc định, giữ nguyên mọi hành vi hiện tại) hoặc `robot`.
   - Miền chọn khi tạo, và chỉ đổi được khi workflow còn rỗng.
   - Không trộn block hai miền; RSS không bao giờ rơi về VSS.
3. **Studio không compile, không chạy hành vi robot.**
   - Studio chỉ adapter thuần (canvas → `robotflow.v1`) và gọi BFF.
   - BFF gọi robotics qua HTTP contract có version.
4. **Không làm hỏng xe.** Golden, contract, diagnostic, E2E của miền xe giữ nguyên; CI xe hiện có là gate hồi quy.

## 2. Điểm gắn cụ thể

| Việc | Hiện có (xe) | Thêm cho robot |
|---|---|---|
| Block config | `apps/sim/blocks/vehicle/{factory.ts,block-specs.json,index.ts}`, đăng ký trong `blocks/registry.ts` dưới `// SV:` | `apps/sim/blocks/robot/{factory.ts,rf-block-specs.json,index.ts}`; snapshot sinh từ registry `robotics/robotflow` bằng script, CI so khớp (parity test, như `block-parity.test.ts`) |
| Palette/toolbar | `lib/sv/toolbar-allowlist.ts` (`sv_*,note,loop,parallel`) | Lọc theo miền của workflow đang mở: robot ⇒ `rf_*,note`; xe ⇒ như cũ |
| Lưu miền | `sv_workflow_settings` (`vss_release NOT NULL`) | Bảng mới `sv_robot_workflow_settings(workflow_id PK → workflow.id, profile, rss_catalog_hash, updated_at)`; có hàng ⇒ miền robot. Migration `0254_…` trong `packages/db`. Không đổi bảng xe |
| Export/import | `lib/sv/workflow-sidecar.ts` (khoá `simvehicleapp`) | Thêm `simvehicleapp.robot = { profile, rssCatalogHash, scenarios[] }`; import kiểm schema, phần sai bị bỏ và báo |
| Adapter canvas | `lib/sv/graph-adapter.ts` → WorkflowGraph v1 | `lib/sv/robotics/robot-graph-adapter.ts` → `robotflow.v1`: thuần, tất định, golden test; giữ id block, mọi cổng kết quả, props có kiểu, biến |
| Lint realtime | `components/sv/lint/lint-runner.tsx` + `/api/sv/lint` | Cùng runner, chọn adapter theo miền; BFF `/api/sv/robotics/lint` → `robotflow /lint`; Problems tab hiển thị mã `RF*` |
| Chọn tín hiệu | `components/sv/vss/vss-path-selector.tsx` | `components/sv/rss/rss-path-selector.tsx`: cây `Robot.*`, kind/đơn vị/độ tươi, lọc theo kind hợp lệ của prop |
| Test | Test workbench (ADR-0058) | Tab Test miền robot: scenario `scenario.v1`, chạy trên `mock`, kết quả PASS/FAIL + lý do |
| Run/Live | `components/sv/run/{run-buttons,run-console,flow-panel,signals-panel}.tsx` | Cùng khung dock; nguồn dữ liệu là `/api/sv/robotics/runs/*`. Nút Start/Stop, chọn mode `mock`/`ros-sim`, Flow tô block đang chạy, Signals RSS, log |
| Deploy | Deploy targets (ADR-0060) | Deploy robot = gắn build bất biến với target `mock`/`ros-sim` đã quan sát; nút *Mở Robot Zoo* (tab mới, chỉ để xem 3D) |
| BFF | `app/api/sv/*`, `lib/sv/api-client.ts` (`SV_SERVICES`) | `app/api/sv/robotics/{catalog,blocks,lint,builds,deployments,runs,scenarios}`; service mới `robotics` (env `SV_ROBOTICS_URL`) và `robotflow` (`SV_ROBOTFLOW_URL`) trong `lib/core/config/env.ts`; mọi route kiểm session + quyền workspace/workflow như route xe |
| Trợ lý AI | `modules/simvehicleapp-ai/src/{tools.ts,prompt.ts,patch.ts}` | Tool theo miền: `rss_search`, `rss_get_signal`, `robot_blocks_list`, `robot_validate`, `robot_scenario_propose`, `robot_scenario_run` (chỉ `mock`). `workflow_propose_patch` mang `domain`. **Không có tool Arm/Start/Stop/setpoint cho robot** |
| Compose | `modules/simvehicleapp-studio/compose.simvehicleapp.yaml` | Overlay tuỳ chọn `overlays/robotics.yaml`: gắn service `studio` vào network external `sr-gui` và đặt URL robotics. Stack robotics là compose project riêng `sr` |

## 3. Luồng người dùng

1. **New workflow → chọn "Robot (RSS)"** → chọn profile `dog-go2-sim` (mặc định duy nhất v0.1). Canvas mở với trigger *Khi bắt đầu*.
2. **Kéo block** từ palette nhóm Trigger, Luồng, Dữ liệu, An toàn, Chuyển động, Điều hướng.
   - Kéo một tín hiệu từ cây RSS vào canvas ⇒ menu "Đọc / Khi đổi / Khi điều kiện", như cách làm với VSS hiện có.
3. **Problems:** lỗi/cảnh báo `RF*` hiện ngay trên block (đỏ/vàng), quick-fix khi có.
4. **Test:** tạo scenario (tay hoặc trợ lý đề xuất) → *Run tests* trên mock → kết quả.
5. **Build:** hiển thị hash artifact, danh sách file, cảnh báo an toàn.
   - **Deploy:** chọn `ros-sim`; GUI hiện target thật (scene, robot, mode Brain).
   - Deploy không chạy gì.
6. **Start:** hộp xác nhận ghi rõ robot, mode, scene và "robot sẽ được Arm bởi workflow" nếu có `rf_arm`.
   - Flow tô block đang chạy; Signals hiện RSS; Console hiện log.
   - *Mở Robot Zoo* để xem robot 3D.
7. **Stop:** luôn hiển thị, ưu tiên cao nhất; trạng thái chỉ chuyển "Đã dừng" khi Protobus xác nhận `SAFE_STOP` thật.

## 4. Quy tắc giao diện và hiệu năng (ADR-0070)

- **Live signals:** GUI nhận tối đa **10 Hz/tín hiệu**, tối đa 40 path hiển thị cùng lúc. Gộp cập nhật trong một `requestAnimationFrame`.
- **Kênh Flow/log:** SSE qua BFF, batch 100 ms. Tab ẩn ⇒ dừng nhận live (vẫn giữ Stop hoạt động).
- **Lint debounce 300 ms** (như xe). Không lint khi đang kéo.
- **Không tải ảnh camera vào studio.** Hình robot xem ở Robot Zoo (repo dog), vốn đã được tối ưu ở R3.

## 5. Kiểm chứng (M26 gate)

- **Unit và golden:**
  - adapter round-trip: canvas → `robotflow.v1` → không mất block/cổng/props;
  - từ chối đồ thị trộn miền;
  - snapshot block parity.
- **Route BFF:** 401/403/404 như route xe; không có đường nào để trình duyệt chọn URL thực thi.
- **E2E Playwright trên GUI thật:**
  - tạo workflow robot bằng kéo thả;
  - lint, Test trên mock, build, deploy, Start/Stop;
  - trợ lý đề xuất patch và người dùng Accept;
  - toàn bộ E2E xe hiện có vẫn PASS.
