# `sv_while` v1 — While (P1, container)
Nguồn: [05 §2.5–2.7](../../../../../analysis/05-blocks-and-execution-model.md#25-flow-control), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md).

- **Opcode:** `control.while`; container subflow `loop` của Sim. Handle vào `target`; ra `loop-start-source` (thân) và `loop-end-source` (khi điều kiện false).
- **`condition`:** boolean, kiểm trước mỗi vòng. **`maxIterations`:** bắt buộc (mặc định 1 000; thiếu ⇒ `LOOP_GUARD_MISSING`); vượt ⇒ dừng run + trace. **`intervalMs`:** nghỉ giữa vòng; mỗi vòng là yield point.
- **Output:** `index` (`<loop.index>`).
