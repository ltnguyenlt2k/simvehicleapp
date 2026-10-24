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
- [ ] Đặc tả `data.eval = {refs, result}` trong `analysis/08` (trace) + mô tả trong `trace-event.v1` (description, không đổi schema) — làm ở T07.
- [x] Block quyết định: `sv_if` (`control.branch`), `sv_switch`, `sv_stable_for`, `sv_wait_until`. Trigger `crosses_above/below`, `rising/falling` **không** có `eval`: trigger không có `exit`, giá trị đã nằm ở `trigger.outputs` (`value`, `previous`) — đủ để Flow giải thích (ghi ở ADR-0062 Notes).
- [x] `refs` theo thứ tự xuất hiện; tối đa 8; chuỗi ≤ 120 đơn vị UTF-16 (như JS); int64 là chuỗi (`toJson` theo kiểu IR); chỉ có khi level `node` (sự kiện `exit` không có ở level `trigger`).
- [x] Simulator (T02a) + C++ + Python + Rust (T02b) phát giống nhau: generator truyền `refs` (key, kiểu IR, giá trị) vào `branch`/`switch`/`wait_until`/`stable_for`; runtime tính lúc `exit`. Conformance so cả `eval` cho golden.
- [x] `expected.trace.json` GW-A/B/G cập nhật có review ở T02a; golden code C++/Python/Rust GW-A/B/G đổi byte có chủ đích ở T02b (chỉ thêm danh sách `refs` vào các quyết định; diff đã review).
- Bằng chứng T02b 2026-10-24: C++ gtest 19/19 (GW-A so từng sự kiện, có `eval`), conformance C++ 53/53; Python pytest 43/43, conformance 53/53, ruff sạch trên code sinh; Rust fmt + clippy + test sạch (không feature `host`), conformance 53/53; generator `bun test` 15/17/17 với golden mới. Parity P3 so cả `eval` (bỏ strip) — chạy trên stack sau khi CI dựng image (T07).

### T03: Mô hình Flow
- [x] Kiểu `FlowRun`, `FlowStep` (design §3.1); `cause` từ signal update gần nhất ≤ 1 s, cùng giá trị với `trigger.outputs.value`. Không khớp thì không có `cause`; view hiện `trigger.outputs`.
- [x] Xử lý: `cancel` (policy restart), `error`, run chưa kết thúc (`running`), sampling (`data.dropped`), block chờ (thời lượng = enter→exit nên gồm thời gian chờ). Run bị huỷ khi đang chờ giữ bước mở (GW-A run 2).
- [x] Câu dễ đọc ở mức mô hình: `evalText` (toán hạng ⇒ kết quả), `SOURCE_TEXT`, `stepDuration`. Tên block từ câu tóm tắt (M16-T08), đơn vị/enum từ catalog và nhãn nhánh (M16-T09) ghép ở view (T04) vì cần workflow + catalog; mô hình giữ thuần.
- [x] Giữ 200 lần chạy gần nhất; ghi số lần chạy đã ẩn (`hidden`).
- Bằng chứng 2026-10-24: `lib/sv/flow-trace.test.ts` 9/9 (snapshot GW-B; GW-A…G: số run = số trigger, write gắn đủ; trace sao chép cho cùng kết quả; 5 000 sự kiện < 50 ms); tsc hẹp sạch; biome sạch.

### T04: Flow view
- [x] Live: pane "Flow" giữa Run console và Messages (`LiveFlowTab`, trace của workflow đang mở + signal update từ bảng Signals, run store giữ 2 000); follow mặc định, ⏸ khi người dùng cuộn.
- [x] Simulate: công tắc Timeline / Flow; bấm lần chạy ⇒ con trỏ tua nhảy tới `startedAt`; tua ⇒ lần chạy chứa con trỏ sáng và mở.
- [x] Test: tab Test dùng cùng `SimulationTimeline` cho case đang chọn nên mỗi case có Flow của lần Simulate. Flow của Play (app thật) là pane Flow ở Live.
- [x] Bấm bước ⇒ chọn block. Bấm write ⇒ mở signal ở Signals: **chuyển T05** (ADR-0062 Notes).
- [x] Lọc theo trigger và kết quả (lọc theo block: chưa làm, vì một lần chạy thường ≤ 10 block); tải JSONL (`flowJsonl`: trace gốc rồi các lần chạy).
- Bằng chứng 2026-10-24: vitest `flow-panel.test.tsx` 3/3, `flow-trace.test.ts` 9/9, run/sim/stores 58 test; tsc hẹp sạch. E2E: `m5-simulate` thêm chặng Flow (CI); `m15-full-flow` `@live` thêm chặng Flow ở Live (chạy ở T07 trên stack dev).

### T05: Nguồn tín hiệu + console
- [x] Contract `signal-update.v1`: `source` ∈ {inject, playback, mirror, app, vehicle} (optional); CHANGELOG; mô tả OpenAPI gateway; zod studio; types sinh lại. `actor` hoãn (ADR-0062 Notes).
- [x] Gateway gắn nguồn (`sources.ts`, cửa sổ ±250 ms cho giá trị chính gateway đặt); test từng nguồn: inject, app (target), mirror, vehicle, playback, ngoài cửa sổ, app v2 (provider).
- [x] Console: câu dễ đọc (`▶ … fired`, `→`, `← … → then (Speed = 130 ⇒ true)`, `writes`, `publishes`, `✖ … failed`), công tắc Sentences / Raw, dòng `● path = v — you injected / test playback` xen theo thời gian.
- [x] (từ T04) Bấm write trong Flow ở Live ⇒ bảng Signals watch tín hiệu đó và cuộn tới dòng của nó.
- Bằng chứng 2026-10-24: gateway `bun test` 26/26 (3 test nguồn mới); contracts `bun test` 399/399; studio vitest 357 (gồm `run-console.test.ts` 2 mới); tsc orchestrator + tsc hẹp studio sạch. `bun test` toàn orchestrator: 5 test workspace FAIL trên máy này do `tar: Cannot mkdir: Operation not permitted` trong thư mục tạm (môi trường, không liên quan; CI chạy). E2E `m8-run` thêm Sentences/Raw (CI).

### T06: Giải thích FAIL + tạo case từ lần chạy
- [x] Mỗi kỳ vọng không đạt ⇒ lần chạy gần nhất, nhánh thực tế + `eval`, nhánh cần (duyệt ngược từ block Set của path) — khung "Why the case failed" dưới kết quả Simulate; bấm ⇒ chọn block. Chỉ cho Simulate; Play giữ mismatch dạng chuỗi (ADR-0062 Notes).
- [x] "Make test case from this run" (Live, Simulate) ⇒ case mới qua BFF hiện có (`useCreateSvTestCase`): initial, input, writes `within` 300 ms + `never`.
- Bằng chứng 2026-10-24: vitest `fail-explain.test.ts` 4/4 (ghi lệch giờ, nhánh broken kèm giá trị, run bị huỷ khi chờ, trigger không chạy, `never`, không block nào ghi), `case-from-run.test.ts` 3/3 (case hợp lệ với `svScenarioSchema`); studio vitest 364; tsc hẹp sạch. E2E `m5-simulate` thêm "Make test case" (CI). E2E cho "Why the case failed": chưa có, làm ở T07 cùng full luồng.

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
