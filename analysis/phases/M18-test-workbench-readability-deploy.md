# M18: Bàn thử nghiệm (test case), workflow dễ đọc v2, Deploy

> **Yêu cầu:** PO 2026-10-15 — các ô inject, ô thêm tín hiệu, Record/scenario/trợ lý soạn test, Simulation/Signals rối, khung Connections, block chưa trực quan, Deploy lấy dữ liệu thật.
> **Thiết kế:** [docs/design/M18-test-workbench-readability-deploy.md](../../docs/design/M18-test-workbench-readability-deploy.md).
> **ADR:** [0058](../adr/ADR-0058-test-workbench-scenarios-as-tests.md), [0059](../adr/ADR-0059-workflow-readability-v2.md), [0060](../adr/ADR-0060-deploy-targets-and-vehicle-io-layers.md) (Proposed — chờ PO xác nhận).
> **Phụ thuộc:**
> - M17: ADR-0056/0057. Sandbox mỗi run (M17-T04) là nền cho Play test và Deploy Remote.
> - M17-T08 được gộp vào M18-T05.
>
> **Nguyên tắc:**
> - làm tuần tự;
> - thay đổi contract/backend phải giữ conformance và golden không đổi byte;
> - mọi thay đổi người dùng thấy phải làm đủ AGENTS.md §4 bước 7–8.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Phân tích + thiết kế + ADR 0058–0060 + phase + ROADMAP | docs | — | Tài liệu commit; ADR Proposed |
| T02 | Test case: contracts (`scenarios` nhiều case, `caseName`) + bảng `sv_workflow_test_cases` + migrate + BFF | contracts, studio | T01, M17 xong | Contract additive + CHANGELOG; migrate scenario cũ ⇒ "Default"; vitest route |
| T03 | Generator 3 backend: một test mỗi case | compiler-code-* | T02 | Conformance C01–C45 + golden cũ không đổi; golden mới cho nhiều case |
| T04 | Tab **Test**: danh sách case, soạn bảng (YAML nâng cao), Simulate pass/fail, Generate tests + độ phủ nhánh, Play chấm kỳ vọng, trạng thái rỗng dẫn dắt | studio, core | T02 | Vitest + E2E |
| T05 | Tab **Live**: ô nhập theo catalog, tìm kiếm gợi ý + kéo thả, tín hiệu từ biểu thức, danh sách lưu theo workflow, Messages HMI/MQTT, gợi ý trigger; Build log drawer; dock 3 tab | studio, signal-gateway | T04 | Vitest + E2E (spec dựa `data-sv-tab` cập nhật) |
| T06 | Trợ lý: tool `scenario_list/propose/run`, "Ask the assistant" từ tab Test | ai, studio | T04 | Unit + eval fake + eval model thật của PO |
| T07 | Block gọn + Details; Logic view tất định + chọn câu ⇒ block | studio | T01 | Vitest 41 BlockSpec + 7 golden; E2E |
| T08 | Làn theo trigger (Auto layout), giá trị sống trên cạnh, "Data from earlier blocks" + "Used by" | studio | T07 | Vitest + E2E |
| T09 | Deploy: Settings → Deploy targets, Test connection, target Remote databroker (sandbox + proxy read-only + audit), Deployment trên Vehicle apps | contracts, orchestrator, velocitas-stack, studio | M17-T04 | Unit + gate databroker ngoài có feeder giả lập + E2E |
| T10 | Deploy target Container image (build + push registry) | velocitas-stack, orchestrator | T09 | Gate với registry cục bộ |
| T11 | Đóng milestone: gate, full luồng `@live` (Test/Live/Deploy), video mới, README + user guide (`test-signals.md` viết lại), báo cáo M18 | all, docs | T02–T10 | CI + nightly xanh; `docs/reports/M18.md` |

## Checklist chi tiết

### T02: Test case — dữ liệu và contract
- [x] `scenario.v1.1` (additive, bump minor):
  - `within` trên `write`/`publish`; `never: [{path, from, to}]`; kỳ vọng là tập con;
  - simulator `checkExpectations` + 3 runtime conformance hiểu bản mới;
  - C01–C45 không đổi.
- [x] `scenario.v1` giữ nguyên.
- [x] `generateRequest.scenarios[]` và orchestrator `startGeneration.scenarios[]` cho nhiều phần tử cùng `workflowId` + `caseName` (additive), kèm CHANGELOG.
- [x] Bảng `sv_workflow_test_cases(id, workflow_id, name, scenario, position, updated_at)`.
- [x] Migration copy `sv_workflow_scenarios` ⇒ case "Default" (0253). Bảng cũ giữ một release, rồi bỏ. *(chạy thật trên stack: chờ)*
- [x] BFF CRUD case; SynCode gửi mọi case.
- [x] Download/Duplicate workflow (M17-T03) mang theo mọi case.

### T03: Generator nhiều test
- [x] C++, Python, Rust: một test mỗi case, tên từ `caseName` (an toàn ký tự).
- [x] Conformance + golden cũ không đổi.
- [x] Golden mới: GW-A với 3 case.

### T04: Tab Test
> 2026-10-24: xong code + vitest + gate Play trên stack; E2E trình duyệt chờ CI. Lệch: Generate dùng WorkflowGraph (ADR-0058 Notes).
- [x] Danh sách case (thêm, đổi tên, nhân bản, xoá).
- [x] Soạn bảng: Given (giá trị đầu), When (t, path, giá trị, ô nhập theo catalog), Then (path/HMI/publish, giá trị, dung sai). Có chế độ YAML.
- [x] Simulate một case / tất cả: kết quả pass/fail từng kỳ vọng; timeline kết quả; tua lại trên canvas.
- [x] Generate tests từ IR theo design M18 §9.4: đường đi theo nhánh, giá trị biên, giữ đủ / phá trước hạn, `false → true`; kỳ vọng lấy từ simulator, người dùng duyệt; độ phủ nhánh + đánh dấu nhánh chưa phủ trên canvas.
- [x] Play trên app thật dùng `within` mặc định 300 ms, báo độ lệch thực tế.
- [x] Play on vehicle stack (khi Run): chấm kỳ vọng từ luồng tín hiệu thật.
- [x] Trạng thái rỗng: Generate tests / Ask the assistant / Record from a live run. Luồng 1-2-3 tô bước hiện tại.

### T05: Tab Live + dock
> 2026-10-24: xong code + vitest + narrow tsc; Messages kiểm với mosquitto thật; E2E chờ CI. Lệch: Build log là tab đóng được (không phải drawer nổi).
- [x] Dock: Problems · Test · Live. Build log thành drawer: mở khi SynCode chạy hoặc lỗi; mở lại từ pill.
- [x] Ô nhập theo catalog:
  - sensor/attribute chỉ value; actuator: request (target) mặc định, simulate feedback (current) ở menu phụ;
  - boolean = công tắc, enum = dropdown, số = ô có đơn vị + min/max;
  - Enter = Set.
- [x] Tìm kiếm có gợi ý (catalog `vss_search`); kéo tín hiệu từ panel Vehicle vào bảng.
- [x] Tín hiệu tự gồm `path` + mọi `<Vehicle.…>` trong biểu thức/template (parser chung với `lib/sv/block-refs`). Danh sách thêm tay lưu theo workflow.
- [x] Messages:
  - signal-gateway subscribe Mosquitto theo topic prefix của app/run, stream SSE;
  - UI hiện HMI (tiêu đề, mức, nội dung) và publish khác.
- [x] Gợi ý: trigger "rises: false → true"; tín hiệu chưa có giá trị.
- [x] Record ⇒ case mới, đề xuất kỳ vọng từ các lần ghi/publish quan sát được.

### T06: Trợ lý soạn test
- [x] Tool `scenario_list`, `scenario_propose` (proposal ⇒ thẻ trong panel trợ lý ⇒ Add to Test tab / Reject), `scenario_run` (Simulate ⇒ pass/fail). 2026-10-24: thẻ đặt trong panel trợ lý thay vì xem trước trong tab Test (ít đổi layout; Accept mở tab Test với case đầu đã chọn) — ADR-0058 Notes.
- [x] Câu "test workflow này" ⇒ prompt hướng dẫn model đề xuất case phủ các nhánh (`scenario_propose` tự Simulate từng case và báo pass/fail).
- [ ] Eval: fake provider (unit, ✔) + model thật của PO (PO đồng ý 2026-10-24; chưa chạy).

### T07: Block gọn + Logic view
- [ ] Block gọn mặc định; toggle Details (lưu theo người dùng); handle neo như cũ.
- [ ] `lib/sv/logic-view.ts`: graph ⇒ văn bản có cấu trúc (trigger, nhánh lồng, chuỗi hành động); tiếng Anh/tiếng Việt; tất định.
- [ ] Chọn câu ⇒ chọn/căn giữa block; lỗi lint hiện trong câu.
- [ ] Vitest: 41 BlockSpec, 7 golden, chạy 2 lần giống nhau.

### T08: Làn, giá trị sống, dữ liệu block trước
- [ ] Auto layout xếp mỗi trigger một làn; nhánh then lên, else xuống; vùng nền có tên trigger.
- [ ] Giá trị sống trên cạnh khi tua Simulate/Run; nhánh chạy sáng, nhánh không chạy mờ.
- [ ] "Data from earlier blocks" (đổi tên Connections + giải thích): kiểu, đơn vị, giá trị mẫu; bấm chèn; trigger ghi rõ không có đầu vào; mục "Used by".

### T09: Deploy Remote databroker
- [ ] **Spike vehicle-gateway:** proxy gRPC HTTP/2 lọc theo method, giữ stream hai chiều. Thử `node:http2` dưới Bun, nếu không ổn thì dùng Node runtime; ghi kết quả vào ADR-0060 Notes.
- [ ] vehicle-gateway:
  - TLS + token tới target; allowlist method read-only/read-write theo design M18 §9.2; audit;
  - app trỏ `SDV_VEHICLEDATABROKER_ADDRESS` vào gateway; Live subscribe qua gateway.
- [ ] Test connection kiểm API target có (`sdv.databroker.v1` bắt buộc với app hiện tại; `kuksa.val.v1` cho Live) và báo không tương thích.
- [ ] Deployment không tự hết hạn; quota `SV_MAX_DEPLOYMENTS_PER_WORKSPACE`; một app có thể vừa Run vừa Deploy.
- [ ] Định nghĩa PO (2026-10-15): Run = tín hiệu giả lập để test; Deploy = tín hiệu từ layer khác.
  - Ở Deploy: signal-gateway/orchestrator **từ chối** inject, Play scenario/test case, Record, mirror ⇒ 409 `SIMULATED_INPUT_DISABLED` (mã diagnostic mới, chỉ thêm).
  - UI tắt các nút đó, hiện "signals come from <target>; test inputs are disabled"; tab Live chỉ quan sát.
  - Unit + E2E chứng minh.
- [ ] Contracts: `DeployTarget{id, name, kind, url, tls, auth, apiVersion, vssRelease}`, `Deployment{…}`; additive.
- [ ] Settings → Deploy targets (admin workspace); secrets mã hoá; Test connection (kết nối, TLS/token, v1/v2, release, path app dùng có tồn tại).
- [ ] Deploy ⇒ sandbox (ADR-0057) nối databroker ngoài qua proxy gRPC; mặc định read-only (chặn `set`); bật ghi phải xác nhận liệt kê actuator.
- [ ] Từ chối generation chưa pass / lệch release. Audit log. Dừng / rollback generation trước.
- [ ] Vehicle apps hiện "Deployed to <target>"; tab Live đọc từ target.
- [ ] Gate: service "external-databroker" + feeder giả lập (như CAN provider) ⇒ app chạy logic với dữ liệu tự đến; read-only chặn ghi; bật ghi ⇒ actuator đổi.

### T10: Deploy Container image
- [ ] Build image từ `app/Dockerfile` (toolchain), đóng kèm AppManifest + NOTICE/license; push registry (cấu hình target `kind: registry`).
- [ ] Gate với registry cục bộ trong compose.

### T11: Đóng milestone
- [ ] Gate M18 (test case, Play chấm điểm, Deploy Remote) trên stack dev + nightly.
- [ ] Full luồng `@live` viết lại theo Test/Live/Deploy. **Quay lại video**; README + `docs/user-guide/test-signals.md` (viết lại) + tutorial.
- [ ] `docs/reports/M18.md`, ROADMAP, CHANGELOG, `sv refresh`.

## Acceptance gate
1. Người dùng mới tạo và chạy được test cho workflow mà không đọc tài liệu: Generate tests hoặc trợ lý ⇒ Simulate ⇒ pass/fail rõ; Play trên app thật chấm cùng kỳ vọng.
2. Tab Live: thêm tín hiệu bằng tìm kiếm/kéo thả; ô nhập đúng kiểu; thấy HMI/MQTT.
3. Logic view đọc đúng 7 golden; block gọn; giá trị sống khi tua; "Data from earlier blocks" giải thích rõ.
4. Deploy Remote databroker: app nhận dữ liệu từ feeder không qua UI; mọi đầu vào giả lập (inject, Play, Record, mirror) bị từ chối ở server; read-only mặc định; audit đủ.
5. Conformance/golden/parity không đổi; CI + nightly xanh; full luồng `@live`, video và README cập nhật.
