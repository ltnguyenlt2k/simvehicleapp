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
| T04 | Runtime: khoá theo databroker, thời hạn, extend, 409 kèm `owner`, `stopReason` | contracts, orchestrator | T01 | Unit đủ nhánh (đồng hồ giả); contract additive + CHANGELOG |
| T05 | UI bận/Stop/Extend/cảnh báo, thẻ Vehicle runtime; `scripts/sv runs`; gate chờ chỗ + trap stop; AI tool `run` | studio, scripts, gate, ai | T04 | Vitest + E2E mock; gate hai release song song + hết hạn |
| T06 | Trợ lý: thời gian đã chờ + nút huỷ trong lúc "Working…" | studio, ai | T02 | Vitest; E2E fake provider chậm |
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

### T04: Runtime theo databroker
- [ ] Contracts (additive):
  - `Run.expiresAt`, `Run.extensions`, `Run.stopReason`;
  - `POST /runs/{rid}/extend`;
  - 409 `activeRun.owner` (`same-workspace | other-workspace | system`; tên app chỉ khi cùng workspace).

  Ghi CHANGELOG.
- [ ] `runs.ts`:
  - khoá theo `databrokers[project.vssRelease]`;
  - timer hết hạn (`SV_RUN_MAX_MINUTES`, `0` = tắt) dừng như Stop với `stopReason: expired`;
  - extend tới `SV_RUN_MAX_EXTENSIONS`.

  Timer phải khôi phục sau khi orchestrator restart.
- [ ] Quyền Stop/Extend: orchestrator nhận workspace của người gọi từ BFF. Khác workspace ⇒ 403.
- [ ] Compose + `.env.example`: `SV_RUN_MAX_MINUTES`, `SV_RUN_MAX_EXTENSIONS`.
- [ ] Unit:
  - hai release song song; cùng release ⇒ 409 `owner` đúng;
  - hết hạn; extend tới giới hạn; restart giữa chừng giữ hạn.

### T05: Hiển thị và giải phóng
- [ ] BFF chuyển `activeRun` đã lọc quyền. Nút Run ở trạng thái bận: "Vehicle stack v4.0 busy — frees at hh:mm".
- [ ] Nút Stop cho người cùng workspace có quyền write.
- [ ] Pill `Running 12:30 · ends 14:00`; cảnh báo 5 phút trước khi hết hạn, có nút Extend.
- [ ] System status: thẻ **Vehicle runtime** (mỗi databroker: trống/bận, đến khi nào).
- [ ] `scripts/sv runs list|stop <id>`.
- [ ] Gate live:
  - chờ databroker trống (`SV_GATE_RUN_WAIT_S`);
  - trap Stop run khi thoát (`scripts/lib/sv-apps.sh` thêm `sv_stop_runs`).
- [ ] AI tool `run`: đọc 409 mới thành câu dễ hiểu.
- [ ] DEPLOY/OPERATIONS: mục "Runtime dùng chung".

### T06: Trợ lý đang chạy
- [ ] Hiện thời gian đã chờ; nút **Stop** huỷ lượt đang chạy (abort request + server bỏ kết quả).
- [ ] Vitest; E2E với fake provider có độ trễ.

### T07: Đóng milestone
- [ ] Gate mới (hai release song song, hết hạn tự dừng) trên stack dev + nightly.
- [ ] Full luồng `@live` (m15-full-flow + restart, tutorial, các spec live). Quay lại video nếu UI trong video đổi (nút Chat biến mất, nút Run bận…).
- [ ] README chính + user guide: bỏ mô tả Chat (nếu có), ghi chú runtime dùng chung, "Download workflow".
- [ ] `docs/reports/M17.md`, ROADMAP, CHANGELOG, `sv refresh`.

## Acceptance gate
1. Editor không còn đường nào chạy workflow bằng executor của Sim. Chỉ còn Simulate, Run và Assistant.
2. Download/Import và Duplicate giữ release VSS + scenario (E2E v4.2).
3. Hai app khác release chạy song song. Cùng release thì người sau thấy ai đang chạy và tới khi nào, cùng workspace thì Stop được. Run hết hạn tự dừng.
4. CI + nightly xanh; full luồng `@live` PASS; README cập nhật đúng hiện trạng.
