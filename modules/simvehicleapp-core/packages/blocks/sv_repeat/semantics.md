# `sv_repeat` v1 — Repeat (P1, container)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.repeat`; container dùng subflow `loop` của Sim (M03-T10). Handle vào `target`; ra `loop-start-source` (thân vòng lặp) và `loop-end-source` (đi tiếp sau vòng cuối).
- **`count`:** 1…10 000; **`intervalMs`:** nghỉ giữa các vòng (mặc định 0). Mỗi vòng là **yield point** (ADR-0012 §3).
- **Output:** `index` (0-based, uint32), đọc trong thân bằng `<loop.index>`.
- Thân rỗng/không hợp lệ ⇒ `CONTAINER_INVALID`.
