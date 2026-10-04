# `sv_clamp` v1 — Clamp (P1)
Nguồn: [05 §2](../../../../../analysis/05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1), [ADR-0012](../../../../../analysis/adr/ADR-0012-execution-semantics.md), [ADR-0013](../../../../../analysis/adr/ADR-0013-dataflow-and-expression-language.md).

- **Loại:** bước thuần (category `logic`), không yield, không side-effect; handle vào `target`, ra `source`/`error` (canvas Sim). Opcode `expr` ⇒ compiler **gộp** vào biểu thức của node dùng output (06 §2.2), không sinh node riêng.
- **`value`, `min`, `max`:** biểu thức cùng kiểu số; tương đương SVX `clamp(value, min, max)`.
- **Output:** `result` cùng kiểu với `value`. `min > max` là hằng ⇒ lỗi cấu hình.
