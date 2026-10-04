# `sv_stable_for` v1 — Stable for
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.stable_for`; yield point. Handle vào `target`; ra `stable` (giữ đủ `durationMs`) và `broken` (bị phá trước hạn; tuỳ chọn nối).
- **`condition`:** biểu thức boolean; bỏ trống ⇒ "giá trị trigger không đổi" (giá trị của trigger mở run này).
- **`durationMs`:** ≥ 1. Kết hợp trigger `restart` cho mẫu "stable overspeed" (05 §3.2).
