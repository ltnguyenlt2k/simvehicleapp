# `sv_scale` v1 — Map range (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`:** biểu thức số; **`inMin`, `inMax`, `outMin`, `outMax`:** số; **`clamp`** (mặc định true): kẹp kết quả trong `[outMin, outMax]`.
- **Output:** `result` double = `outMin + (value − inMin) × (outMax − outMin) / (inMax − inMin)` (tương đương hàm SVX `scale`).
- **Edge case:** `inMin == inMax` ⇒ lỗi cấu hình (compile).
