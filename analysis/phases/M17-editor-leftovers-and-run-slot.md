# M17: Dọn bề mặt Sim còn sót trong editor + chia sẻ runtime xe

> **Yêu cầu:** PO 2026-10-15 (khung Chat, menu "…", lỗi "Another project is running on the vehicle stack").
> **Thiết kế:** [docs/design/M17-editor-leftovers-and-run-slot.md](../../docs/design/M17-editor-leftovers-and-run-slot.md).
> **ADR:** [0056](../adr/ADR-0056-sim-execution-surfaces-and-workflow-menu.md), [0057](../adr/ADR-0057-shared-vehicle-runtime-run-slot.md) (Proposed, theo uỷ quyền PO 2026-10-06, chờ xác nhận).
> **Phụ thuộc:** M16 (ADR-0053/0054 Proposed). M17 không đổi phần M16 đã làm, chỉ bổ sung.
> **Nguyên tắc:**
> - làm tuần tự; type-check studio để CI chạy;
> - mọi thay đổi người dùng thấy phải làm đủ AGENTS.md §4 bước 7: full luồng `@live`, quay lại video nếu UI đổi, cập nhật README.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Phân tích + thiết kế + ADR 0056/0057 + phase + ROADMAP | docs | — | Tài liệu commit; ADR Proposed |
| T02 | Ẩn Chat và "Run from/until block" (bề mặt executor của Sim) | studio | T01 | Vitest danh sách ẩn; route chat/execute 404; E2E không còn các mục này |
| T03 | Menu workflow: "Download workflow (.json)" giữ release VSS + scenario; import khôi phục; Duplicate copy đủ | studio | T02 | Vitest round-trip + duplicate; E2E v4.2 + scenario qua duplicate/download→import |
| T04a | **Spike** sandbox mỗi run: databroker dạng tiến trình trong toolchain, đo khởi động/RAM, 5 run song song cùng release, VSS tuỳ biến | velocitas-stack | T01 | Số đo + kết luận ghi vào ADR-0057 Notes; quyết định đi tiếp/sửa ADR |
| T04 | Runtime multi-user: sandbox mỗi run, quota user/host, thời hạn, extend, `stopReason`, `RUN_QUOTA_EXCEEDED` | contracts, orchestrator, velocitas-stack | T04a | Unit đủ nhánh (đồng hồ giả); contract additive + CHANGELOG + catalog diagnostic |
| T05 | Signal-gateway theo run; UI "My runs", hộp thoại cùng user, cảnh báo hết hạn, thẻ Vehicle runtime; `scripts/sv runs`; gate; AI tool `run` | signal-gateway, studio, scripts, gate, ai | T04 | Vitest + E2E mock; gate hai user cùng release song song + hết hạn + quota |
| T06 | Trợ lý "đang suy nghĩ": hiệu ứng, bước tool thật, chữ hiện dần, thời gian chờ, Stop | studio, ai | T02 | Vitest; E2E fake provider có độ trễ |
| T07 | Gate + full luồng `@live` + video (nếu UI đổi) + README + báo cáo M17 | all, docs | T02–T06 | CI + nightly xanh; `docs/reports/M17.md` |

## Checklist chi tiết

### T02: Ẩn bề mặt executor của Sim
- [ ] `lib/sv/hidden-surfaces.ts` (một danh sách) + test.
- [ ] Ẩn ở 3 chỗ:
  - nút Chat cạnh menu "…" (`panel.tsx`);
  - "Open/Close Chat" (`canvas-menu.tsx`);
  - phím tắt mở Chat (`workflow.tsx`).
- [ ] Ẩn "Run from block" / "Run until block" (`block-menu.tsx`, `action-bar.tsx` của block).
- [ ] BFF/proxy: `api/workflows/[id]/chat*` và `api/workflows/[id]/execute` trả 404 cho studio. Kiểm trước không có tính năng SimVehicleApp nào dùng các route này (AI, MCP, gate).
- [ ] E2E: không có nút Chat, mục "Open Chat", mục "Run from block"; snapshot thanh panel.
- [ ] Khai báo file Sim trong `UPSTREAM_SYNC.allow`.

### T03: Menu workflow giữ dữ liệu xe
- [ ] Đổi nhãn "Export workflow" thành "Download workflow (.json)"; tooltip phân biệt với Export (zip app).
- [ ] JSON tải về có `simvehicleapp: { vssRelease, scenario }`. Import (`import-export.ts`) khôi phục release và scenario.
- [ ] File JSON cũ không có phần mở rộng ⇒ import dùng release mặc định và **cảnh báo** rõ trong toast.
- [ ] Duplicate (`api/workflows/[id]/duplicate`) copy `sv_workflow_settings` + `sv_workflow_scenarios` trong cùng transaction.
- [ ] Vitest: round-trip; duplicate copy đủ; workflow không có dữ liệu xe vẫn duplicate được.
- [ ] E2E: workflow v4.2 có scenario ⇒ Duplicate ⇒ bản sao v4.2 + Simulate cùng kết quả; Download → Import tương tự.

### T04a: Spike sandbox mỗi run
- [ ] Image toolchain (hoặc image runtime riêng) có binary `databroker` của `ghcr.io/eclipse-kuksa/kuksa-databroker:0.5.0` (multi-stage `COPY --from`); NOTICE Apache-2.0.
- [ ] Toolchain agent spawn `databroker --insecure --port <free> --vss <file release>` cạnh app; app nhận `SDV_VEHICLEDATABROKER_ADDRESS` của sandbox.
- [ ] Đo: thời gian databroker sẵn sàng, RAM mỗi sandbox, 5 run song song cùng v4.0 (inject vào run 1 không đổi run 2), release tuỳ biến (file từ vss-catalog).
- [ ] Ghi số đo vào ADR-0057 Notes; sửa ADR nếu kết quả khác giả định.

### T04: Runtime multi-user (orchestrator)
- [ ] Contracts (additive): `Run.expiresAt`, `Run.extensions`, `Run.stopReason`, `Run.sandbox` (nội bộ); `POST /runs/{rid}/extend`; diagnostic `RUN_QUOTA_EXCEEDED` (catalog, chỉ thêm); CHANGELOG.
- [ ] `runs.ts`:
  - bỏ khoá toàn host; quota `SV_MAX_RUNS_PER_USER` / `SV_MAX_RUNS_TOTAL` (user lấy từ BFF);
  - cấp cổng sandbox; khi run kết thúc dọn cả databroker lẫn app;
  - restart orchestrator ⇒ dọn sandbox mồ côi, giữ hạn của run còn sống.
- [ ] Thời hạn `SV_RUN_MAX_MINUTES` (`0` = tắt), `stopReason: expired`; extend tới `SV_RUN_MAX_EXTENSIONS`.
- [ ] Quyền: Stop/Extend chỉ chủ run hoặc người cùng workspace có quyền write; khác workspace ⇒ 403.
- [ ] Compose + `.env.example` + DEPLOY: các biến mới, ước lượng tài nguyên mỗi run.
- [ ] Unit:
  - quota user/host;
  - hai run cùng release song song;
  - hết hạn; extend tới giới hạn;
  - 403; restart giữa chừng.

### T05: Định tuyến, hiển thị, quản trị
- [ ] Signal-gateway: Signals/inject/mirror/play theo `runId` ⇒ databroker của sandbox; bảng `SV_DATABROKERS` chỉ còn cho Signals khi chưa có run và cho gate cũ.
- [ ] Studio:
  - "My runs (n)" trên thanh hành động (app, release, thời gian, hết hạn, Stop);
  - pill theo app đang mở; cảnh báo 5 phút + Extend;
  - Vehicle apps đánh dấu app đang chạy.
- [ ] Hộp thoại cùng user:
  - đang có run khác ⇒ **Dừng X và chạy Y / Chạy song song / Huỷ**;
  - cùng app ⇒ **Khởi động lại**;
  - hết quota ⇒ chỉ còn Dừng/Huỷ.
- [ ] System status: thẻ **Vehicle runtime** (số run/quota, RAM sandbox).
- [ ] `scripts/sv runs list|stop <id>`; gate trap Stop run khi thoát (`sv_stop_runs`).
- [ ] AI tool `run`: đọc `RUN_QUOTA_EXCEEDED` / thời hạn thành câu dễ hiểu.
- [ ] DEPLOY/OPERATIONS: mục "Runtime nhiều người dùng".
- [ ] Gate trên stack: hai user cùng v4.0 song song, mỗi người inject và nhận đúng output của mình; hết hạn tự dừng; quota chặn đúng.

### T06: Trợ lý "đang suy nghĩ"
- [ ] Thay chữ tĩnh "Working…" (`assistant-panel.tsx`):
  - biểu tượng trợ lý có vòng sáng nhấp nháy + 3 chấm chạy;
  - chữ "Thinking…" có hiệu ứng shimmer, dùng token màu sẵn có;
  - tắt animation khi `prefers-reduced-motion`.
- [ ] Danh sách bước theo sự kiện thật: `tool` ⇒ dòng mới có spinner với nhãn dễ hiểu (bảng ánh xạ tên tool → nhãn; tool lạ ⇒ tên tool); `tool_result` ⇒ ✓ / ✕.
- [ ] Chữ trả lời hiện dần theo `text` delta, có con trỏ nhấp nháy.
- [ ] Thời gian đã chờ; sau 30 s gợi ý "Model đang trả lời chậm" + provider/model.
- [ ] Nút **Stop**: abort request; server huỷ lượt, không áp đề xuất dở dang.
- [ ] Không hiển thị chuỗi suy nghĩ nội bộ của model.
- [ ] Vitest:
  - ánh xạ nhãn; trạng thái bước ✓/✕;
  - reduced-motion;
  - Stop huỷ request.
- [ ] E2E: fake provider có độ trễ ⇒ thấy Thinking…, bước, thời gian; Stop.

### T07: Đóng milestone
- [ ] Gate mới (hai release song song, hết hạn tự dừng) trên stack dev + nightly.
- [ ] Full luồng `@live` (m15-full-flow + restart, tutorial, các spec live). Quay lại video nếu UI trong video đổi (nút Chat biến mất, nút Run bận…).
- [ ] README chính + user guide: bỏ mô tả Chat (nếu có), ghi chú runtime dùng chung, "Download workflow".
- [ ] `docs/reports/M17.md`, ROADMAP, CHANGELOG, `sv refresh`.

## Acceptance gate
1. Editor không còn đường nào chạy workflow bằng executor của Sim. Chỉ còn Simulate, Run và Assistant.
2. Download/Import và Duplicate giữ release VSS + scenario (E2E v4.2).
3. Nhiều user (kể cả cùng release) chạy song song, mỗi run có sandbox riêng, tín hiệu không lẫn. Cùng user được hỏi dừng/chạy song song và thấy "My runs". Quota user/host chặn đúng. Run hết hạn tự dừng.
4. Trợ lý hiện rõ đang suy nghĩ (hiệu ứng, bước thật, thời gian) và Stop được.
5. CI + nightly xanh; full luồng `@live` PASS; README cập nhật đúng hiện trạng.
