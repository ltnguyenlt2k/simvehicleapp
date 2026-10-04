# `sv_wait` v1 — Wait
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.wait`; **yield point** (ADR-0012 §3). Handle vào `target`, ra `source` (đi tiếp sau khi chờ). Không có nhánh lỗi.
- **`durationMs`:** ≥ 0 (0 = nhường lượt rồi đi tiếp). Run bị huỷ (policy `restart`, stop) ⇒ timer bị huỷ theo cancel token.
