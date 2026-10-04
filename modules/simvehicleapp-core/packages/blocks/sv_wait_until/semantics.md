# `sv_wait_until` v1 — Wait until (P1)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.wait_until`; yield point. Handle vào `target`; ra `ok` (điều kiện thành true) và `timeout`.
- **`condition`:** biểu thức boolean, đánh giá lại khi signal/biến trong đó đổi (runtime subscribe), và ngay khi vào block (đã true ⇒ `ok` ngay).
- **`timeoutMs`:** ≥ 1, bắt buộc (không chờ vô hạn).
