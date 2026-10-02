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
