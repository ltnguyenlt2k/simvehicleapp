# ADR-0042: Semantic parity testing (Simulator ≡ Runtime ≡ Binary thật)

- **Status:** Proposed · **Date:** 2026-09-30 · **Level:** L2
- **Related:** FR-RUN-07, R7; Master Plan Phase 27; [14 §3](../14-testing-strategy.md#3-parity-so-sánh-gì)

## Decision
1. Ba mức tương đương, cùng `scenario` + `expected`:
   - **P1 Conformance** (mỗi PR của backend): runtime ngôn ngữ + MockVehicle + VirtualClock ⇒ trace chuẩn hoá == expected (tất định tuyệt đối).
   - **P2 Simulator** (mỗi PR core): simulator ⇒ == expected.
   - **P3 Binary thật** (nightly): app build thật + databroker thật + scenario player (qua signal-gateway) ⇒ trace/writes khớp theo lưới 10 ms, dung sai timer ±20 ms.
2. `expected` được sinh ban đầu từ simulator, **review thủ công**, rồi đóng băng; thay đổi cần PR có lý do.
3. Mọi backend mới phải pass P1+P3 cho mọi golden mà nó khai báo hỗ trợ.

## Verification
Nightly dashboard parity; release gate 100%.

## Notes / Deviations (2026-10-07) — P3 hiện thực (M11-T01), theo uỷ quyền PO 2026-10-06, chờ PO xác nhận
1. **Runner:** `modules/simvehicleapp-orchestrator/gate/parity-p3.{sh,ts}` đi đúng đường sản phẩm: project → SynCode (golden + scenario của nó) → Run → signal-gateway `/play` → trace của Run (`/events`), so với `expected.trace.json`. Nightly chạy sau live smoke, báo cáo JSON là artifact `parity-p3` (dashboard).
2. **So sánh:** cùng chuỗi sự kiện (ev, wf, run, node, block, data bỏ `timestamp`); thời gian: trigger đo từ gốc = trung vị độ lệch của các trigger (jitter của bộ phát nằm trong dung sai), sự kiện khác đo **thời gian phản ứng** kể từ trigger gần nhất (timer/`stable_for`/`wait_until` mới là điều P3 cần kiểm). Dung sai 10 ms lưới + 20 ms. Sự kiện sau `until` của scenario không thuộc lượt so sánh.
3. **Mô hình không có provider:** expected (simulator) không có provider — giá trị current của actuator chỉ đổi khi scenario đặt. Stack dev mirror target → current (vai provider, ADR-0024): P3 tắt mirror sau khi Run khởi động, và đặt cả **target** của actuator về giá trị `initial` (target cũ còn sót bị mirror chép sang current lúc Run bật mirror — lỗi gặp ở GW-G).
4. **Đồng hồ:** bộ phát scenario lập lịch trên đồng hồ monotonic và không bao giờ phát sớm (Bun timer thức sớm tới ~3 %; đồng hồ thực WSL nhảy ~1 s/phút) — sửa trong signal-gateway. Runner phát hiện bước nhảy đồng hồ thực trong lúc chạy (so `Date.now` với `performance.now`) và chạy lại golden đó (≤ 2 lần), ghi vào báo cáo.
5. **Kết quả 2026-10-07 (dev stack, WSL):** 7/7 golden, lệch tối đa 7 ms — `docs/reports/evidence/M11-parity-p3-local.json`.
