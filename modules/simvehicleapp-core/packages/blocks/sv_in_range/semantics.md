# `sv_in_range` v1 — In range / Hysteresis (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước có **state** (category `logic`), opcode `logic.in_range` — không gộp được vào biểu thức vì mode hysteresis nhớ trạng thái giữa các lần chạy; handle `target`/`source`/`error`.
- **`value`, `low`, `high`:** biểu thức số. **`mode`:** `range` (mặc định) ⇒ `result = low ≤ value ≤ high`, không state; `hysteresis` ⇒ `state` bật khi `value ≥ high`, tắt khi `value ≤ low`, giữ nguyên giữa hai ngưỡng.
- **Outputs:** `result` boolean, `state` boolean (trạng thái hysteresis; bằng `result` ở mode `range`).
- **State** gắn với block (không theo run), khởi tạo false khi app chạy.
