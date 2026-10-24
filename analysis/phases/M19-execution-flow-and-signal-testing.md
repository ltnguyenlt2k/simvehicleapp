# M19: Luồng thực thi (Flow) và thử tín hiệu chỉn chu

> **Yêu cầu:** PO 2026-10-24 — "các chỗ dùng simulate tín hiệu, test workflow … làm chỉn chu lại, log tracking show luồng; phần đã có làm chuẩn chỉnh chính xác hơn, phần chưa có thì thêm mới".
> **Thiết kế:** [docs/design/M19-execution-flow-and-signal-testing.md](../../docs/design/M19-execution-flow-and-signal-testing.md) (§2 kiểm kê hiện trạng).
> **ADR:** [0062](../adr/ADR-0062-execution-flow-trace-and-signal-testing.md) (Proposed — chờ PO xác nhận).
> **Phụ thuộc:**
> - M18-T04/T05 (tab Test, tab Live) và M18-T08 (giá trị sống trên cạnh dùng chung mô hình Flow, nên làm T03 trước T08 nếu song song).
> - Gate M18 PASS trước khi tick milestone M19 (luật cứng 7). Phân tích/ADR (T01) làm được ngay.
>
> **Nguyên tắc:**
> - thay đổi trace là additive; conformance và parity phải xanh cho cả 3 runtime;
> - golden sinh code không đổi byte (chỉ runtime và trace kỳ vọng của conformance đổi);
> - mọi thay đổi người dùng thấy phải làm đủ AGENTS.md §4 bước 7–8.

## Tasks

| ID | Task | Module | Phụ thuộc | DoD |
|---|---|---|---|---|
| T01 | Phân tích + kiểm kê + thiết kế + ADR-0062 + phase + ROADMAP | docs | — | Tài liệu commit; ADR Proposed |
| T02a | `data.eval` ở `exit` của block quyết định trong **simulator**; parity bỏ qua `eval` (ADR-0062 Notes) | core | T01 | Simulator test; golden trace cập nhật có review; parity P3 7/7 |
| T02b | Generator truyền danh sách tham chiếu ⇒ runtime C++/Python/Rust phát `eval` | compiler-code-* | T02a | Golden code đổi byte có chủ đích, review diff; conformance; parity so cả `eval` |
| T03 | `lib/sv/flow-trace.ts`: `TraceEvent[]` + signal updates ⇒ `FlowRun[]`; câu dễ đọc | studio | T01 | Snapshot GW-A…G tất định (2 lần); 5 000 sự kiện ≤ 50 ms |
| T04 | Flow view: pane Flow ở Live, cạnh timeline Simulate, trong mỗi case Test; chọn bước ⇒ block; lọc; tải JSONL | studio | T03 | Vitest + E2E |
| T05 | `signal-update.source` (+`actor`) ở gateway; Run console dạng câu + Raw + dòng input | contracts, orchestrator, studio | T01 | Contract minor + CHANGELOG; unit gateway (inject/playback/mirror/app/vehicle); vitest console |
| T06 | Giải thích case FAIL (điểm lệch đầu tiên, nhánh cần); "Make test case from this run" | studio | T03, T04 | Vitest; E2E |
| T07 | Đóng milestone: gate, full luồng `@live`, video, README + user guide, báo cáo M19 | all, docs | T02–T06 | CI + nightly xanh; `docs/reports/M19.md` |

## Checklist chi tiết

### T02: Lý do rẽ nhánh trong trace
- [ ] Đặc tả `data.eval = {refs, result}` trong `analysis/08` (trace) + mô tả trong `trace-event.v1` (description, không đổi schema).
- [ ] Block: `sv_if`, `sv_switch`, `sv_stable_for`, `sv_wait_until`, trigger `crosses_above/below`, `rising/falling`.
- [ ] `refs` theo thứ tự xuất hiện; tối đa 8; chuỗi ≤ 120 ký tự; int64 là chuỗi; chỉ ở level `node`.
- [ ] Simulator + C++ + Python + Rust phát giống nhau; trace kỳ vọng conformance cập nhật một lần, review diff.
- [ ] `golden-trace.ts`: `expected.trace.json` GW-A…G cập nhật có review (nguồn chuẩn cho parity).

### T03: Mô hình Flow
- [ ] Kiểu `FlowRun`, `FlowStep` (design §3.1); `cause` từ signal update gần nhất ≤ 1 s, nếu không có thì lấy `trigger.outputs`.
- [ ] Xử lý: `cancel` (policy restart), `error`, run chưa kết thúc (`running`), sampling (`data.dropped`), block chờ (Stable for / Wait until: thời lượng gồm thời gian chờ).
- [ ] Câu dễ đọc: tên block từ câu tóm tắt (M16-T08), giá trị có đơn vị/enum từ catalog, nhánh có nhãn (M16-T09).
- [ ] Giữ 200 lần chạy gần nhất; ghi số lần chạy đã ẩn.

### T04: Flow view
- [ ] Live: pane thứ ba "Flow" cạnh Run console / Messages; follow mặc định, ⏸ khi người dùng cuộn.
- [ ] Simulate: Flow cạnh timeline; bấm lần chạy ⇒ con trỏ tua nhảy tới; tua ⇒ lần chạy tương ứng sáng.
- [ ] Test: mỗi case mở Flow của case đó (Simulate hoặc Play).
- [ ] Bấm bước ⇒ chọn/căn giữa block; bấm write ⇒ mở signal ở Signals.
- [ ] Lọc theo trigger/block/kết quả; tải JSONL (trace gốc + flow).

### T05: Nguồn tín hiệu + console
- [ ] Contract `signal-update.v1`: `source` ∈ {inject, playback, mirror, app, vehicle}, `actor` (optional); CHANGELOG; OpenAPI gateway.
- [ ] Gateway gắn nguồn (cửa sổ ±250 ms cho giá trị do chính gateway đặt); test từng nguồn.
- [ ] Console: câu dễ đọc, "Raw", dòng `input` từ signal updates có `source` inject/playback.

### T06: Giải thích FAIL + tạo case từ lần chạy
- [ ] Mỗi kỳ vọng không đạt ⇒ lần chạy gần nhất, nhánh thực tế + `eval`, nhánh cần (duyệt ngược từ block Set của path).
- [ ] "Make test case from this run" (Live, Simulate) ⇒ case mới qua BFF (initial, input, writes + `never`, `within` 300 ms).

### T07: Đóng milestone
- [ ] Gate M19 trên stack dev + nightly.
- [ ] Full luồng `@live`: inject ⇒ Flow đúng nguồn/nhánh/giá trị; case FAIL chỉ đúng điểm lệch.
- [ ] Quay lại video; README + `docs/user-guide/test-signals.md` + `scenarios.md`.
- [ ] `docs/reports/M19.md`, ROADMAP, CHANGELOG, `sv refresh`.

## Acceptance gate
1. Ở Simulate, Test và Live, người dùng thấy cùng một cách hiển thị luồng: lần chạy → bước → nhánh (kèm giá trị điều kiện) → write.
2. Mỗi input hiện nguồn (inject / playback / app / mirror / vehicle).
3. Case FAIL chỉ ra điểm lệch đầu tiên; tạo được test case từ một lần chạy thật.
4. Conformance C01–C45 + parity P3 xanh cho 3 runtime với `eval`; golden code không đổi.
5. CI + nightly xanh; full luồng `@live`, video và README cập nhật.
